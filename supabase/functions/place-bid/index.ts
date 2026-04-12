import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    )

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser()

    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { auctionId, amountCents, maxBidCents } = await req.json()

    if (!auctionId || !amountCents) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: auctionId, amountCents' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { data: auction, error: auctionError } = await supabaseClient
      .from('auctions')
      .select('*')
      .eq('id', auctionId)
      .single()

    if (auctionError || !auction) {
      return new Response(
        JSON.stringify({ error: 'Auction not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (auction.status !== 'ACTIVE') {
      return new Response(
        JSON.stringify({ error: 'Auction is not active' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const now = new Date()
    const endTime = new Date(auction.end_time)
    if (now >= endTime) {
      return new Response(
        JSON.stringify({ error: 'Auction has ended' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (auction.seller_id === user.id) {
      return new Response(
        JSON.stringify({ error: 'Cannot bid on your own auction' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const minimumBid = auction.current_price_cents + auction.minimum_increment_cents
    if (amountCents < minimumBid) {
      return new Response(
        JSON.stringify({
          error: 'Bid too low',
          minimumBid,
          currentPrice: auction.current_price_cents
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { data: bid, error: bidError } = await supabaseClient
      .from('bids')
      .insert({
        auction_id: auctionId,
        bidder_id: user.id,
        amount_cents: amountCents,
        max_bid_cents: maxBidCents || null,
        is_auto_bid: false
      })
      .select()
      .single()

    if (bidError) {
      console.error('Bid insert error:', bidError)
      return new Response(
        JSON.stringify({ error: bidError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { data: updatedAuction } = await supabaseClient
      .from('auctions')
      .select('current_price_cents, high_bidder_id')
      .eq('id', auctionId)
      .single()

    return new Response(
      JSON.stringify({
        success: true,
        bid,
        isHighBidder: updatedAuction?.high_bidder_id === user.id,
        currentPrice: updatedAuction?.current_price_cents
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Edge function error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
