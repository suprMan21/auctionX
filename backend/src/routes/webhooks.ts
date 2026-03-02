import { Router } from 'express';
import crypto from 'crypto';
import { supabase } from '../lib/supabase';
import { log } from '../lib/logger';

const router = Router();

router.post('/paymentcloud', async (req, res) => {
  const requestId = req.headers['x-request-id'] as string || crypto.randomUUID();

  log.info('paymentcloud_ipn_received', {
    requestId,
    body: req.body
  });

  try {
    const {
      action,
      orderid,
      transactionid,
      response,
      responsetext,
      response_code,
      amount,
      merchant_defined_field_1: auctionId,
      merchant_defined_field_2: correlationId
    } = req.body;

    if (!orderid) {
      log.warn('paymentcloud_ipn_missing_orderid', { requestId });
      return res.status(200).send('OK');
    }

    const { data: transaction, error } = await supabase
      .from('transactions')
      .select('id, status')
      .eq('id', orderid)
      .single();

    if (error || !transaction) {
      log.warn('paymentcloud_ipn_unknown_transaction', {
        requestId,
        orderid,
        error: error?.message
      });
      return res.status(200).send('OK');
    }

    switch (action) {
      case 'sale':
        if (response === '1') {
          await supabase
            .from('transactions')
            .update({
              status: 'SUCCEEDED',
              successful_processor: 'PAYMENTCLOUD',
              successful_payment_id: transactionid,
              payment_completed_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            })
            .eq('id', orderid);

          log.info('paymentcloud_payment_completed_ipn', {
            requestId,
            transactionId: orderid,
            nmiTransactionId: transactionid,
            correlationId
          });
        } else if (response === '2') {
          await supabase
            .from('payment_attempts')
            .insert({
              transaction_id: orderid,
              correlation_id: correlationId,
              processor: 'PAYMENTCLOUD',
              attempt_number: 1,
              success: false,
              error_code: response_code || 'DECLINED',
              error_message: responsetext,
              raw_response: req.body,
              created_at: new Date().toISOString()
            });

          log.info('paymentcloud_payment_declined_ipn', {
            requestId,
            transactionId: orderid,
            responseCode: response_code,
            correlationId
          });
        }
        break;

      case 'refund':
        if (response === '1') {
          await supabase
            .from('transactions')
            .update({
              status: 'REFUNDED',
              updated_at: new Date().toISOString()
            })
            .eq('id', orderid);

          log.info('paymentcloud_refund_completed_ipn', {
            requestId,
            transactionId: orderid,
            nmiTransactionId: transactionid
          });
        }
        break;

      case 'chargeback':
        await supabase
          .from('transactions')
          .update({
            status: 'DISPUTED',
            updated_at: new Date().toISOString()
          })
          .eq('id', orderid);

        log.warn('paymentcloud_chargeback_received', {
          requestId,
          transactionId: orderid,
          amount,
          correlationId
        });
        break;

      default:
        log.info('paymentcloud_ipn_unhandled_action', {
          requestId,
          action,
          transactionId: orderid
        });
    }

    res.status(200).send('OK');

  } catch (error) {
    log.error('paymentcloud_ipn_processing_error', {
      requestId,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    res.status(200).send('OK');
  }
});

export default router;
