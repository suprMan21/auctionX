/**
 * ConversationsPage — two-panel messaging UI
 *
 * Routes:
 *   /messages                  — conversation list (mobile: full-screen list)
 *   /messages/:conversationId  — active thread (mobile: full-screen thread)
 *
 * Desktop: left panel = conversation list, right panel = active thread.
 * Mobile: navigate between list (/messages) and thread (/messages/:id).
 *
 * Realtime:
 *   - conversations channel: subscribe to INSERT/UPDATE filtered to current user
 *     to update the sidebar (new conversations, last_message_at changes).
 *   - messages channel: subscribe to INSERT on active conversation_id to
 *     append incoming messages without polling.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { api } from '@/lib/api';
import { useAuth } from '@/features/auth/hooks/useAuth';
import type { ConversationWithDetails, Message } from '../types/messaging';
import toast from 'react-hot-toast';

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) {
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }
  if (diffDays < 7) {
    return date.toLocaleDateString('en-US', { weekday: 'short' });
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function getListingTitle(conv: ConversationWithDetails): string {
  if (!conv.listings) return 'Unknown listing';
  if (Array.isArray(conv.listings)) {
    return conv.listings[0]?.title ?? 'Unknown listing';
  }
  return conv.listings.title ?? 'Unknown listing';
}

// ── ConversationRow ───────────────────────────────────────────────────────────

function ConversationRow({
  conv,
  isActive,
  onClick,
}: {
  conv: ConversationWithDetails;
  isActive: boolean;
  onClick: () => void;
}) {
  const displayName = conv.other_participant?.username ?? 'Unknown user';
  const avatar = conv.other_participant?.avatar_url;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left px-4 py-3 flex items-start gap-3 transition-colors
        hover:bg-white/5 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary-500
        ${isActive ? 'bg-white/10 border-l-2 border-purple-500' : 'border-l-2 border-transparent'}`}
    >
      {/* Avatar */}
      <div className="flex-shrink-0 w-10 h-10 rounded-full bg-white/10 flex items-center justify-center overflow-hidden">
        {avatar ? (
          <img src={avatar} alt={displayName} className="w-full h-full object-cover" />
        ) : (
          <span className="text-gray-400 text-sm font-semibold">
            {displayName.charAt(0).toUpperCase()}
          </span>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-white truncate">{displayName}</span>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {conv.unread_count > 0 && (
              <span className="w-5 h-5 rounded-full bg-red-500 text-white text-xs flex items-center justify-center font-semibold">
                {conv.unread_count > 9 ? '9+' : conv.unread_count}
              </span>
            )}
            <span className="text-xs text-gray-400">{formatTime(conv.last_message_at)}</span>
          </div>
        </div>
        <p className="text-xs text-gray-400 truncate mt-0.5">
          {conv.last_message_preview ?? getListingTitle(conv)}
        </p>
      </div>
    </button>
  );
}

// ── MessageBubble ─────────────────────────────────────────────────────────────

function MessageBubble({ message, isMine }: { message: Message; isMine: boolean }) {
  return (
    <div className={`flex ${isMine ? 'justify-end' : 'justify-start'} mb-2`}>
      <div
        className={`max-w-[75%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
          isMine
            ? 'bg-gradient-to-r from-purple-600 to-blue-500 text-white rounded-br-sm'
            : 'bg-white/5 text-gray-200 rounded-bl-sm border border-white/10'
        }`}
      >
        <p className="whitespace-pre-wrap break-words">{message.body}</p>
        <p className={`text-xs mt-1 ${isMine ? 'text-white/60 text-right' : 'text-gray-400'}`}>
          {formatTime(message.created_at)}
          {isMine && message.read_at && (
            <span className="ml-1" title="Read">✓</span>
          )}
        </p>
      </div>
    </div>
  );
}

// ── MessageThread ─────────────────────────────────────────────────────────────

function MessageThread({
  conv,
  userId,
  onBack,
}: {
  conv: ConversationWithDetails;
  userId: string;
  onBack: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const displayName = conv.other_participant?.username ?? 'Unknown user';
  const listingTitle = getListingTitle(conv);

  // Fetch initial messages
  useEffect(() => {
    let mounted = true;
    setLoading(true);

    api.getMessages(conv.id)
      .then(({ messages: msgs }) => {
        if (mounted) setMessages(msgs);
      })
      .catch(() => {
        if (mounted) toast.error('Failed to load messages');
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => { mounted = false; };
  }, [conv.id]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Realtime: subscribe to new messages in this conversation
  useEffect(() => {
    const channel = supabase
      .channel(`messages:${conv.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conv.id}`,
        },
        (payload: { new: Message }) => {
          setMessages((prev) => {
            // Avoid duplicate if we just inserted it ourselves
            if (prev.some((m) => m.id === payload.new.id)) return prev;
            return [...prev, payload.new];
          });
        }
      )
      .subscribe();

    return () => { channel.unsubscribe(); };
  }, [conv.id]);

  const handleSend = useCallback(async () => {
    const body = draft.trim();
    if (!body || sending) return;

    setSending(true);
    try {
      await api.sendMessage(conv.id, body);
      setDraft('');
      textareaRef.current?.focus();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send message');
    } finally {
      setSending(false);
    }
  }, [conv.id, draft, sending]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Thread header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/10 flex-shrink-0">
        <button
          type="button"
          onClick={onBack}
          className="md:hidden flex items-center justify-center w-8 h-8 rounded-lg text-gray-400
                     hover:text-white hover:bg-white/5 transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500"
          aria-label="Back to conversations"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
        </button>
        <div className="min-w-0">
          <p className="text-white font-semibold text-sm truncate">{displayName}</p>
          <p className="text-gray-400 text-xs truncate">{listingTitle}</p>
        </div>
      </div>

      {/* Messages scroll area */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-gray-400 text-sm">Loading messages…</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-gray-400 text-sm">No messages yet. Say hello!</p>
          </div>
        ) : (
          messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} isMine={msg.sender_id === userId} />
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="flex-shrink-0 border-t border-white/10 px-4 py-3 flex items-end gap-3">
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message… (Enter to send, Shift+Enter for new line)"
          rows={1}
          maxLength={2000}
          className="flex-1 resize-none bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm
                     text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500
                     max-h-32 overflow-y-auto"
          style={{ minHeight: '40px' }}
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={!draft.trim() || sending}
          className="flex-shrink-0 h-10 px-4 bg-gradient-to-r from-purple-600 to-blue-500 hover:from-purple-500
                     hover:to-blue-400 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm
                     font-semibold rounded-xl transition-all focus:outline-none focus:ring-2 focus:ring-primary-500"
        >
          {sending ? '…' : 'Send'}
        </button>
      </div>
    </div>
  );
}

// ── ConversationsSidebar ──────────────────────────────────────────────────────

function ConversationsSidebar({
  conversations,
  loading,
  activeId,
  onSelect,
}: {
  conversations: ConversationWithDetails[];
  loading: boolean;
  activeId: string | null;
  onSelect: (conv: ConversationWithDetails) => void;
}) {
  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-white/10 flex-shrink-0">
        <h1 className="text-lg font-bold text-white">Messages</h1>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <p className="text-gray-400 text-sm">Loading…</p>
          </div>
        ) : conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 px-6 text-center">
            <p className="text-gray-400 text-sm">No conversations yet.</p>
            <p className="text-gray-400 text-xs mt-1">
              Visit a listing and click &quot;Message Seller&quot; to start one.
            </p>
          </div>
        ) : (
          conversations.map((conv) => (
            <ConversationRow
              key={conv.id}
              conv={conv}
              isActive={conv.id === activeId}
              onClick={() => onSelect(conv)}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ── ConversationsPage ─────────────────────────────────────────────────────────

export function ConversationsPage() {
  const { conversationId } = useParams<{ conversationId?: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [conversations, setConversations] = useState<ConversationWithDetails[]>([]);
  const [loadingList, setLoadingList] = useState(true);

  const userId = user?.id ?? '';

  // Active conversation object
  const activeConv = conversationId
    ? conversations.find((c) => c.id === conversationId) ?? null
    : null;

  // Fetch conversation list
  const fetchConversations = useCallback(async () => {
    if (!userId) return;
    try {
      const data = await api.getConversations();
      setConversations(data);
    } catch {
      // Silently fail — list will be empty
    } finally {
      setLoadingList(false);
    }
  }, [userId]);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  // Realtime: subscribe to conversation updates for this user
  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`conversations:${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'conversations',
        },
        () => {
          // Re-fetch the list to get updated previews / unread counts
          fetchConversations();
        }
      )
      .subscribe();

    return () => { channel.unsubscribe(); };
  }, [userId, fetchConversations]);

  const handleSelectConv = (conv: ConversationWithDetails) => {
    navigate(`/messages/${conv.id}`);
    // Clear unread count optimistically
    setConversations((prev) =>
      prev.map((c) => (c.id === conv.id ? { ...c, unread_count: 0 } : c))
    );
  };

  const handleBack = () => navigate('/messages');

  // On mobile, when conversationId is set show only the thread; otherwise show list.
  const showListOnMobile = !conversationId;
  const showThreadOnMobile = !!conversationId;

  return (
    <div className="min-h-screen bg-dark-800">
      <div className="max-w-6xl mx-auto h-[calc(100vh-4rem)] flex">
        {/* Sidebar — always visible on desktop, conditional on mobile */}
        <div
          className={`
            ${showListOnMobile ? 'flex' : 'hidden'} md:flex
            flex-col w-full md:w-80 border-r border-white/10 glass
          `}
        >
          <ConversationsSidebar
            conversations={conversations}
            loading={loadingList}
            activeId={conversationId ?? null}
            onSelect={handleSelectConv}
          />
        </div>

        {/* Main thread panel */}
        <div
          className={`
            ${showThreadOnMobile ? 'flex' : 'hidden'} md:flex
            flex-col flex-1 min-w-0
          `}
        >
          {activeConv && userId ? (
            <MessageThread
              conv={activeConv}
              userId={userId}
              onBack={handleBack}
            />
          ) : (
            <div className="hidden md:flex items-center justify-center flex-1 text-center px-8">
              <div>
                <p className="text-gray-400 font-medium">Select a conversation</p>
                <p className="text-gray-400 text-sm mt-1">Choose from the list on the left to start reading.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
