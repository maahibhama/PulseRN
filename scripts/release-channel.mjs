export function releaseChannel(tag, prefix) {
  const version = tag.startsWith(prefix) ? tag.slice(prefix.length) : '';
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Invalid release tag: ${tag}`);
  }
  return { version, distTag: version.includes('-') ? 'next' : 'latest' };
}
