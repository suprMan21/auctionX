import { useParams, Link, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuction } from '../hooks/useAuction';
import { CountdownTimer } from './CountdownTimer';
import { CurrentBidDisplay } from './CurrentBidDisplay';
import { BidHistory } from './BidHistory';
import { BidPlacementForm } from './BidPlacementForm';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { api } from '@/lib/api';
import type { AuctionSettlementSummary } from '@/features/auctions/types/settlement';
import toast from 'react-hot-toast';

function SettlementBanner({
  summary,
  isWinner,
  isSeller,
}: {
  summary: AuctionSettlementSummary;
  isWinner: boolean;
  isSeller: boolean;
}) {
  if (isWinner) {
    return (
      <div className="mb-4 flex items-center justify-between bg-purple-900/40 border border-purple-500/30 rounded-2xl px-5 py-4 backdrop-blur">
        <div>
          <p className="text-purple-200 font-semibold">You won this auction!</p>
          <p className="text-purple-300/70 text-sm mt-0.5">Complete payment to secure your purchase.</p>
        </div>
        <Link
          to={`/settlements/${summary.settlementId}`}
          className="bg-gradient-to-r from-purple-600 to-blue-500 hover:from-purple-500 hover:to-blue-400 text-white text-sm font-semibold py-2 px-4 rounded-xl transition-all whitespace-nowrap"
        >
          Complete Payment →
        </Link>
      </div>
    );
  }

  if (isSeller) {
    return (
      <div className="mb-4 flex items-center justify-between bg-blue-900/40 border border-blue-500/30 rounded-2xl px-5 py-4 backdrop-blur">
        <div>
          <p className="text-blue-200 font-semibold">Auction ended — awaiting buyer payment.</p>
          <p className="text-blue-300/70 text-sm mt-0.5">View settlement details for status and payout info.</p>
        </div>
        <Link
          to={`/settlements/${summary.settlementId}`}
          className="bg-blue-700/60 hover:bg-blue-600/60 text-blue-100 text-sm font-semibold py-2 px-4 rounded-xl transition-all whitespace-nowrap border border-blue-500/30"
        >
          View Settlement →
        </Link>
      </div>
    );
  }

  return (
    <div className="mb-4 bg-gray-800/60 border border-gray-600/30 rounded-2xl px-5 py-3">
      <p className="text-gray-400 text-sm">This auction has ended.</p>
    </div>
  );
}

export function AuctionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { auction, loading, error } = useAuction(id!);
  const { user } = useAuth();
  const navigate = useNavigate();
  const [settlementSummary, setSettlementSummary] = useState<AuctionSettlementSummary | null>(null);
  const [messageModalOpen, setMessageModalOpen] = useState(false);
  const [messageDraft, setMessageDraft] = useState('');
  const [messageSending, setMessageSending] = useState(false);

  useEffect(() => {
    if (!id) return;
    api.getAuctionSettlement(id).then((summary) => {
      setSettlementSummary(summary);
    }).catch(() => {
      // Non-fatal — settlement banner is optional
    });
  }, [id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-dark-800">
        <div className="text-xl text-gray-400">Loading auction...</div>
      </div>
    );
  }

  if (error || !auction) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-dark-800">
        <div className="glass rounded-2xl p-8 max-w-md text-center border border-red-500/20">
          <p className="text-xl text-red-400 mb-4">{error || 'Auction not found'}</p>
          <div className="flex gap-3 justify-center">
            <Link to="/browse" className="rounded-xl border border-white/10 text-gray-400 hover:bg-white/5 px-4 py-2 text-sm font-medium transition-colors">
              Back to Browse
            </Link>
            <button onClick={() => window.location.reload()} className="rounded-xl bg-gradient-to-r from-primary-500 to-accent-500 text-white px-4 py-2 text-sm font-semibold transition-all">
              Try Again
            </button>
          </div>
        </div>
      </div>
    );
  }

  const isSeller = user?.id === auction.seller_id;
  const canMessageSeller = !!user && !isSeller;

  const handleSendMessage = async () => {
    const body = messageDraft.trim();
    if (!body || messageSending) return;
    if (!auction.listing_id || !auction.seller_id) return;

    setMessageSending(true);
    try {
      const { conversation } = await api.startConversation(
        auction.listing_id,
        auction.seller_id,
        body,
      );
      setMessageModalOpen(false);
      setMessageDraft('');
      navigate(`/messages/${conversation.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send message');
    } finally {
      setMessageSending(false);
    }
  };

  const showSettlementBanner =
    settlementSummary &&
    (auction.status === 'ENDED' || auction.status === 'SETTLED');
  const isWinner = !!user && settlementSummary?.buyerId === user.id;

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
          {showSettlementBanner && (
            <SettlementBanner
              summary={settlementSummary!}
              isWinner={isWinner}
              isSeller={isSeller}
            />
          )}
          <div className="glass rounded-2xl p-6 mb-6">
            <div className="mb-4">
              <span className={`inline-block px-3 py-1 rounded-full text-sm font-medium ${
                auction.status === 'ACTIVE' ? 'bg-green-900/30 text-green-400' :
                auction.status === 'ENDED' ? 'bg-dark-700 text-gray-400' :
                'bg-blue-900/30 text-blue-400'
              }`}>
                {auction.status}
              </span>
            </div>

            <h1 className="text-3xl font-bold text-white mb-4">Auction #{auction.id.slice(0, 8)}</h1>

            {auction.status === 'ACTIVE' && (
              <div className="mb-6">
                <h2 className="text-sm font-medium text-gray-400 mb-2">Time Remaining</h2>
                <CountdownTimer endTime={auction.end_time} />
              </div>
            )}

            <CurrentBidDisplay auction={auction} />
          </div>

          <div className="glass rounded-2xl p-6">
            <BidHistory auctionId={auction.id} currency={auction.currency} />
          </div>
        </div>

        <div className="lg:col-span-1">
          <div className="glass rounded-2xl p-6 sticky top-4">
            <h2 className="text-xl font-bold text-white mb-4">Place Your Bid</h2>

            {!user ? (
              <div className="glass rounded-xl p-4 border border-blue-500/20 text-blue-400">
                Please log in to place a bid
              </div>
            ) : isSeller ? (
              <div className="glass rounded-xl p-4 border border-amber-500/20 text-amber-400">
                You cannot bid on your own auction
              </div>
            ) : (
              <BidPlacementForm auction={auction} />
            )}

            {canMessageSeller && (
              <div className="mt-4">
                <button
                  type="button"
                  onClick={() => setMessageModalOpen(true)}
                  className="w-full py-2.5 px-4 rounded-xl border border-primary-500/40 text-primary-400
                             hover:bg-primary-500/10 transition-colors text-sm font-medium
                             focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  Message Seller
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Message Seller modal */}
      {messageModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4"
          onClick={(e) => { if (e.target === e.currentTarget) setMessageModalOpen(false); }}
        >
          <div className="glass rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <h2 className="text-lg font-bold text-white mb-4">Message Seller</h2>
            <textarea
              value={messageDraft}
              onChange={(e) => setMessageDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); }
              }}
              placeholder="Hi, I have a question about this item…"
              rows={4}
              maxLength={2000}
              autoFocus
              className="w-full resize-none rounded-xl bg-white/5 border border-white/10 text-white text-sm
                         px-3 py-2 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
            <p className="text-xs text-gray-400 mt-1 text-right">{messageDraft.trim().length}/2000</p>
            <div className="flex gap-3 mt-4">
              <button
                type="button"
                onClick={() => { setMessageModalOpen(false); setMessageDraft(''); }}
                className="flex-1 py-2.5 rounded-xl border border-white/10 text-gray-400 hover:text-white
                           hover:bg-white/5 transition-colors text-sm font-medium focus:outline-none focus:ring-2 focus:ring-white/30"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSendMessage}
                disabled={!messageDraft.trim() || messageSending}
                className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-blue-500
                           hover:from-purple-500 hover:to-blue-400 disabled:opacity-40 disabled:cursor-not-allowed
                           text-white text-sm font-semibold transition-all focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                {messageSending ? 'Sending…' : 'Send Message'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
