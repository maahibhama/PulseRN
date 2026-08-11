#import "NotificationService.h"
#import "NotifeeExtensionHelper.h"

@interface NotificationService ()

@property(nonatomic, copy) void (^contentHandler)(UNNotificationContent *contentToDeliver);
@property(nonatomic, strong) UNMutableNotificationContent *bestAttemptContent;

@end

@implementation NotificationService

- (void)didReceiveNotificationRequest:(UNNotificationRequest *)request
                    withContentHandler:(void (^)(UNNotificationContent *_Nonnull))contentHandler {
  self.contentHandler = contentHandler;
  self.bestAttemptContent = [request.content mutableCopy];

  [NotifeeExtensionHelper populateNotificationContent:request
                                          withContent:self.bestAttemptContent
                                   withContentHandler:contentHandler];
}

- (void)serviceExtensionTimeWillExpire {
  if (self.contentHandler && self.bestAttemptContent) {
    self.contentHandler(self.bestAttemptContent);
  }
}

@end
