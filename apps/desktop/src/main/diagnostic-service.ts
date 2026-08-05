import { createHash } from 'node:crypto';
import {
  errorEventPayloadSchema,
  navigationEventPayloadSchema,
  networkEventPayloadSchema,
  networkLifecycleEventPayloadSchema,
  performanceEventPayloadSchema,
  animationEventPayloadSchema,
  workletEventPayloadSchema,
  reduxEventPayloadSchema,
  type DevToolEventEnvelope,
  type DiagnosticEvidence,
  type DiagnosticFinding,
  type DiagnosticRelation,
  type SessionDiagnosis,
} from '@pulse-rn/protocol';
import type { EventCursor, EventDatabase } from './database.js';
import type { SessionManager } from './session-manager.js';

const MAX_DIAGNOSTIC_EVENTS = 2_000;
const TIME_WINDOW_MS = 30_000;

function findingId(kind: string, eventId: string): string {
  return `finding-${createHash('sha256').update(`${kind}:${eventId}`).digest('hex').slice(0, 16)}`;
}

function evidenceSummary(event: DevToolEventEnvelope): string | undefined {
  if (event.category === 'error') {
    const parsed = errorEventPayloadSchema.safeParse(event.payload);
    return parsed.success
      ? `${parsed.data.name}: ${parsed.data.message}`.slice(0, 1_000)
      : undefined;
  }
  if (event.category === 'network') {
    const completed = networkEventPayloadSchema.safeParse(event.payload);
    if (completed.success) {
      return `${completed.data.method} ${completed.data.url} ${completed.data.status ?? completed.data.error?.name ?? ''}`
        .trim()
        .slice(0, 1_000);
    }
    const lifecycle = networkLifecycleEventPayloadSchema.safeParse(event.payload);
    return lifecycle.success
      ? `${lifecycle.data.method} ${lifecycle.data.url} ${lifecycle.data.phase}`.slice(0, 1_000)
      : undefined;
  }
  if (event.category === 'redux') {
    const parsed = reduxEventPayloadSchema.safeParse(event.payload);
    return parsed.success ? parsed.data.actionType.slice(0, 1_000) : undefined;
  }
  if (event.category === 'navigation') {
    const parsed = navigationEventPayloadSchema.safeParse(event.payload);
    return parsed.success
      ? `${parsed.data.action} ${parsed.data.currentRoute?.name ?? parsed.data.routePath?.join(' / ') ?? ''}`.trim()
      : undefined;
  }
  if (event.category === 'performance') {
    const parsed = performanceEventPayloadSchema.safeParse(event.payload);
    return parsed.success
      ? `${parsed.data.name}: ${parsed.data.value} ${parsed.data.unit}`
      : undefined;
  }
  if (event.category === 'animation') {
    const parsed = animationEventPayloadSchema.safeParse(event.payload);
    return parsed.success ? `${parsed.data.animationType} ${parsed.data.phase}` : undefined;
  }
  if (event.category === 'worklet') {
    const parsed = workletEventPayloadSchema.safeParse(event.payload);
    return parsed.success
      ? `${parsed.data.workletName ?? parsed.data.runtimeName ?? parsed.data.runtimeId} ${parsed.data.operation}`
      : undefined;
  }
  return undefined;
}

function explicitIds(event: DevToolEventEnvelope): Set<string> {
  const ids = new Set<string>();
  if (event.parentId) ids.add(event.parentId);
  const payload = event.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return ids;
  const correlations = payload['correlations'];
  if (!correlations || typeof correlations !== 'object' || Array.isArray(correlations)) return ids;
  for (const [key, value] of Object.entries(correlations)) {
    if (typeof value === 'string' && key.toLowerCase().endsWith('id')) ids.add(value);
  }
  return ids;
}

function relationFor(
  primary: DevToolEventEnvelope,
  candidate: DevToolEventEnvelope,
): DiagnosticRelation | undefined {
  if (explicitIds(primary).has(candidate.id)) {
    return {
      eventId: candidate.id,
      confidence: 1,
      reason: 'explicit_event_id',
      description: 'The primary event explicitly references this event.',
    };
  }
  if (primary.parentId === candidate.id || candidate.parentId === primary.id) {
    return {
      eventId: candidate.id,
      confidence: 0.98,
      reason: 'parent_child',
      description: 'The events have an explicit parent-child relationship.',
    };
  }
  if (primary.correlationId && primary.correlationId === candidate.correlationId) {
    return {
      eventId: candidate.id,
      confidence: 0.96,
      reason: 'matching_correlation_id',
      description: `Both events use correlation ID ${primary.correlationId}.`,
    };
  }
  const error = errorEventPayloadSchema.safeParse(primary.payload);
  if (error.success && error.data.context.some((entry) => entry.id === candidate.id)) {
    return {
      eventId: candidate.id,
      confidence: 0.9,
      reason: 'error_context',
      description: 'The SDK captured this event in the error context.',
    };
  }
  const distance = primary.timestamp - candidate.timestamp;
  if (distance >= 0 && distance <= TIME_WINDOW_MS) {
    return {
      eventId: candidate.id,
      confidence: Math.max(0.35, 0.65 - distance / TIME_WINDOW_MS / 3),
      reason: 'time_proximity',
      description: `This event occurred ${Math.round(distance)} ms before the finding; proximity alone is circumstantial.`,
    };
  }
  return undefined;
}

function severityRank(value: DiagnosticFinding['severity']): number {
  return { critical: 4, error: 3, warning: 2, info: 1 }[value];
}

export class DiagnosticService {
  constructor(
    private readonly database: EventDatabase,
    private readonly sessions: SessionManager,
  ) {}

  diagnose(sessionId?: string): SessionDiagnosis {
    const session = sessionId
      ? this.database.listSessions(500).find((entry) => entry.sessionId === sessionId)
      : this.database.listSessions(1)[0];
    if (!session) throw new Error('No PulseRN session is available for diagnosis.');
    const events = this.readBoundedEvents(session.sessionId);
    const findings: DiagnosticFinding[] = [];
    for (const event of events) {
      const relatedCandidates = events
        .filter(
          (candidate) =>
            candidate.id !== event.id &&
            candidate.timestamp <= event.timestamp &&
            event.timestamp - candidate.timestamp <= TIME_WINDOW_MS &&
            [
              'network',
              'redux',
              'navigation',
              'performance',
              'animation',
              'worklet',
              'console',
            ].includes(candidate.category),
        )
        .slice(-50);
      const relations = relatedCandidates
        .map((candidate) => relationFor(event, candidate))
        .filter((relation): relation is DiagnosticRelation => Boolean(relation))
        .sort(
          (left, right) =>
            right.confidence - left.confidence || left.eventId.localeCompare(right.eventId),
        )
        .slice(0, 20);

      if (event.category === 'error') {
        const parsed = errorEventPayloadSchema.safeParse(event.payload);
        if (!parsed.success) continue;
        const frame = parsed.data.frames?.find((entry) => entry.application);
        findings.push({
          id: findingId('application_error', event.id),
          kind: 'application_error',
          severity: parsed.data.fatal ? 'critical' : 'error',
          summary: `${parsed.data.name}: ${parsed.data.message}`.slice(0, 2_000),
          primaryEventId: event.id,
          timestamp: event.timestamp,
          confidence: 1,
          relations,
          ...(frame
            ? {
                source: {
                  file: frame.file,
                  ...(frame.line ? { line: frame.line } : {}),
                  ...(frame.column ? { column: frame.column } : {}),
                  symbolicated: frame.symbolicated,
                },
              }
            : {}),
        });
      }
      if (event.category === 'network') {
        const parsed = networkEventPayloadSchema.safeParse(event.payload);
        const lifecycle = networkLifecycleEventPayloadSchema.safeParse(event.payload);
        const failed =
          (parsed.success && (Boolean(parsed.data.error) || (parsed.data.status ?? 0) >= 400)) ||
          (lifecycle.success && lifecycle.data.phase === 'failure');
        const slow = parsed.success && parsed.data.duration >= 1_000;
        if (failed || slow) {
          const summary = parsed.success
            ? `${parsed.data.method} ${parsed.data.url} ${failed ? `failed (${parsed.data.status ?? parsed.data.error?.name ?? 'network error'})` : `took ${Math.round(parsed.data.duration)} ms`}`
            : lifecycle.success
              ? `${lifecycle.data.method} ${lifecycle.data.url} failed`
              : 'Network request failed';
          findings.push({
            id: findingId('network_failure', event.id),
            kind: 'network_failure',
            severity: failed ? 'error' : 'warning',
            summary: summary.slice(0, 2_000),
            primaryEventId: event.id,
            timestamp: event.timestamp,
            confidence: 1,
            relations,
          });
        }
      }
      if (event.category === 'performance') {
        const parsed = performanceEventPayloadSchema.safeParse(event.payload);
        if (
          parsed.success &&
          (['js_stall', 'long_task'].includes(parsed.data.metric) ||
            (parsed.data.unit === 'ms' && parsed.data.value >= 1_000) ||
            (parsed.data.metric === 'js_fps' && parsed.data.value < 50))
        ) {
          findings.push({
            id: findingId('performance_anomaly', event.id),
            kind: 'performance_anomaly',
            severity: parsed.data.metric === 'js_stall' ? 'error' : 'warning',
            summary: `${parsed.data.name}: ${parsed.data.value} ${parsed.data.unit}`,
            primaryEventId: event.id,
            timestamp: event.timestamp,
            confidence: parsed.data.approximate ? 0.8 : 1,
            relations,
          });
        }
      }
      if (event.category === 'animation') {
        const parsed = animationEventPayloadSchema.safeParse(event.payload);
        if (
          parsed.success &&
          (parsed.data.phase === 'failed' ||
            (parsed.data.frame?.lateFrames ?? 0) > 0 ||
            (parsed.data.frame &&
              parsed.data.frame.observedFrames < parsed.data.frame.expectedFrames))
        ) {
          findings.push({
            id: findingId('animation_anomaly', event.id),
            kind: 'animation_anomaly',
            severity: parsed.data.phase === 'failed' ? 'error' : 'warning',
            summary: `${parsed.data.animationType} animation ${parsed.data.phase}; ${parsed.data.frame?.lateFrames ?? 0} late frames`,
            primaryEventId: event.id,
            timestamp: event.timestamp,
            confidence: 0.95,
            relations,
          });
        }
      }
      if (event.category === 'worklet') {
        const parsed = workletEventPayloadSchema.safeParse(event.payload);
        if (
          parsed.success &&
          (parsed.data.operation === 'failed' ||
            (parsed.data.queueWaitMs ?? 0) > 16 ||
            (parsed.data.durationMs ?? 0) > 16)
        ) {
          findings.push({
            id: findingId('worklet_anomaly', event.id),
            kind: 'worklet_anomaly',
            severity: parsed.data.operation === 'failed' ? 'error' : 'warning',
            summary: `${parsed.data.workletName ?? parsed.data.runtimeId}: ${parsed.data.operation}, ${parsed.data.queueWaitMs ?? 0} ms queued, ${parsed.data.durationMs ?? 0} ms executing`,
            primaryEventId: event.id,
            timestamp: event.timestamp,
            confidence: 0.95,
            relations,
          });
        }
      }
    }

    const liveDevice = this.sessions
      .snapshot()
      .devices.find((device) => device.sessionId === session.sessionId);
    if (
      liveDevice?.health &&
      (liveDevice.health.droppedEvents > 0 || liveDevice.health.queuedEvents > 100)
    ) {
      findings.push({
        id: findingId('transport_degradation', session.sessionId),
        kind: 'transport_degradation',
        severity: liveDevice.health.droppedEvents > 0 ? 'warning' : 'info',
        summary: `${liveDevice.health.queuedEvents} queued and ${liveDevice.health.droppedEvents} dropped SDK events.`,
        timestamp: liveDevice.health.receivedAt,
        confidence: 1,
        relations: [],
      });
    }

    const primaryFailures = findings.filter((finding) =>
      ['application_error', 'network_failure'].includes(finding.kind),
    );
    for (const failure of primaryFailures) {
      for (const relation of failure.relations) {
        const related = events.find((event) => event.id === relation.eventId);
        if (!related || !['redux', 'navigation'].includes(related.category)) continue;
        findings.push({
          id: findingId(
            related.category === 'redux'
              ? 'redux_preceding_failure'
              : 'navigation_preceding_failure',
            related.id,
          ),
          kind:
            related.category === 'redux'
              ? 'redux_preceding_failure'
              : 'navigation_preceding_failure',
          severity: 'info',
          summary:
            evidenceSummary(related) ??
            `${related.category} event preceding ${failure.primaryEventId ?? 'failure'}`,
          primaryEventId: related.id,
          timestamp: related.timestamp,
          confidence: relation.confidence,
          relations: [
            {
              eventId: failure.primaryEventId!,
              confidence: relation.confidence,
              reason: relation.reason,
              description: relation.description,
            },
          ],
        });
      }
    }

    const uniqueFindings = [...new Map(findings.map((finding) => [finding.id, finding])).values()]
      .sort(
        (left, right) =>
          severityRank(right.severity) - severityRank(left.severity) ||
          right.timestamp - left.timestamp ||
          left.id.localeCompare(right.id),
      )
      .slice(0, 200);
    const evidenceIds = new Set(
      uniqueFindings.flatMap((finding) => [
        ...(finding.primaryEventId ? [finding.primaryEventId] : []),
        ...finding.relations.map((relation) => relation.eventId),
      ]),
    );
    const evidence: DiagnosticEvidence[] = events
      .filter((event) => evidenceIds.has(event.id))
      .map((event) => ({
        eventId: event.id,
        timestamp: event.timestamp,
        category: event.category,
        type: event.type,
        ...(evidenceSummary(event) ? { summary: evidenceSummary(event) } : {}),
      }))
      .slice(0, 500);
    return {
      version: 1,
      sessionId: session.sessionId,
      generatedAt: Date.now(),
      findings: uniqueFindings,
      evidence,
      completeness: {
        scannedEvents: events.length,
        totalEvents: session.eventCount,
        truncated: session.eventCount > events.length,
        warnings:
          session.eventCount > events.length
            ? [`Diagnosis scanned the newest ${events.length} of ${session.eventCount} events.`]
            : [],
      },
    };
  }

  eventsForDiagnosis(sessionId: string): DevToolEventEnvelope[] {
    return this.readBoundedEvents(sessionId);
  }

  private readBoundedEvents(sessionId: string): DevToolEventEnvelope[] {
    const events: DevToolEventEnvelope[] = [];
    let cursor: EventCursor | undefined;
    while (events.length < MAX_DIAGNOSTIC_EVENTS) {
      const page = this.database.query({
        sessionId,
        order: 'newest',
        limit: Math.min(500, MAX_DIAGNOSTIC_EVENTS - events.length),
        ...(cursor ? { cursor } : {}),
      });
      events.push(...page.events);
      if (!page.hasNext || !page.nextCursor) break;
      cursor = page.nextCursor;
    }
    return events.sort(
      (left, right) =>
        left.timestamp - right.timestamp ||
        left.sequence - right.sequence ||
        left.id.localeCompare(right.id),
    );
  }
}
