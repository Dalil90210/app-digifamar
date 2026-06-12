/**
 * Chat module — server-side service.
 * NestJS equivalent: chat.service.ts
 */
import type { ChatMessageDto, SendMessageDto, ThreadQueryDto } from "./dto";
import { scanForContactInfo, describeCategories } from "./contact-guard";

/** Thrown when a message tries to smuggle personal contact info off-platform. */
export class ContactInfoBlockedError extends Error {
  constructor(public readonly categories: string[]) {
    super(
      `Message blocked: it contains ${describeCategories(
        categories as never,
      )}. All communication must stay on DiGiFaMaR.`,
    );
    this.name = "ContactInfoBlockedError";
  }
}

const threads = new Map<string, ChatMessageDto[]>();
// Per-thread participant set. The first user to post becomes a participant,
// and any user explicitly added via `send` joins the thread. Only participants
// may read the thread.
const participants = new Map<string, Set<string>>();

function ensureParticipants(threadId: string): Set<string> {
  let set = participants.get(threadId);
  if (!set) {
    set = new Set();
    participants.set(threadId, set);
  }
  return set;
}

export class ChatService {
  static send(authorId: string, input: SendMessageDto): ChatMessageDto {
    // Critical Rule: reject contact-sharing attempts on the wire.
    const scan = scanForContactInfo(input.body);
    if (scan.hasContactInfo) {
      throw new ContactInfoBlockedError(scan.categories);
    }

    const msg: ChatMessageDto = {
      id: `msg_${crypto.randomUUID()}`,
      threadId: input.threadId,
      authorId,
      body: input.body,
      createdAt: new Date().toISOString(),
    };
    const existing = threads.get(input.threadId) ?? [];
    existing.push(msg);
    threads.set(input.threadId, existing);
    ensureParticipants(input.threadId).add(authorId);
    return msg;
  }

  static list(userId: string, query: ThreadQueryDto): ChatMessageDto[] {
    const members = participants.get(query.threadId);
    // If the thread does not exist OR caller is not a participant, return
    // nothing. Never leak messages by thread-id enumeration.
    if (!members || !members.has(userId)) return [];
    const all = threads.get(query.threadId) ?? [];
    return all.slice(-query.limit);
  }
}
