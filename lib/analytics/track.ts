import { ANALYTICS_CONSENT_VERSION } from "@/lib/analytics/consent";
import {
  sanitizeAnalyticsEventInput,
  type AnalyticsEventInput,
  type AnalyticsEventName,
} from "@/lib/analytics/events";

export type AnalyticsCaptureHandler = (
  eventName: AnalyticsEventName,
  properties: Record<string, string | number>,
) => void;

let captureHandler: AnalyticsCaptureHandler | null = null;
let consentAccepted = false;

export function setAnalyticsCaptureHandler(handler: AnalyticsCaptureHandler | null): void {
  captureHandler = handler;
}

export function setAnalyticsConsentAccepted(accepted: boolean): void {
  consentAccepted = accepted;

  if (!accepted) {
    captureHandler = null;
  }
}

export function isAnalyticsTrackingEnabled(): boolean {
  return consentAccepted && captureHandler !== null;
}

export function trackAnalyticsEvent(input: AnalyticsEventInput): boolean {
  if (!consentAccepted || !captureHandler) {
    return false;
  }

  const properties = sanitizeAnalyticsEventInput(input, ANALYTICS_CONSENT_VERSION);

  if (!properties) {
    return false;
  }

  captureHandler(input.event, properties);
  return true;
}

export function __getAnalyticsCaptureHandlerForTests(): AnalyticsCaptureHandler | null {
  return captureHandler;
}

export function __isAnalyticsConsentAcceptedForTests(): boolean {
  return consentAccepted;
}
