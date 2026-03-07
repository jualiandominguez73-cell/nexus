/**
 * In-memory store for outbound call context.
 * Maps a Twilio CallSid to the context of who requested the call and why.
 */

export interface OutboundCallContext {
    /** Twilio CallSid */
    callSid: string;
    /** Phone number being called */
    to: string;
    /** The objective the AI must accomplish during the call */
    objective: string;
    /** Telegram chat ID to send the summary back to */
    telegramChatId: number;
    /** Thread ID used in Firestore for this call's conversation */
    threadId: string;
    /** Accumulates key points from the conversation for the final summary */
    conversationLog: string[];
    /** Timestamp when the call was initiated */
    createdAt: Date;
}

const outboundCalls = new Map<string, OutboundCallContext>();

export function setOutboundContext(callSid: string, ctx: OutboundCallContext) {
    outboundCalls.set(callSid, ctx);
}

export function getOutboundContext(callSid: string): OutboundCallContext | undefined {
    return outboundCalls.get(callSid);
}

export function deleteOutboundContext(callSid: string) {
    outboundCalls.delete(callSid);
}

export function getAllOutboundCalls(): Map<string, OutboundCallContext> {
    return outboundCalls;
}
