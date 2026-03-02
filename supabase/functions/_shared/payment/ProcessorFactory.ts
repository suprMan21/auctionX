import { BaseProcessor } from './BaseProcessor.ts';
import { ProcessorConfig, ProcessorType } from './types.ts';
import { StripeProcessor } from './processors/StripeProcessor.ts';
import { PaymentCloudProcessor } from './processors/PaymentCloudProcessor.ts';
import { SignatureProcessor } from './processors/SignatureProcessor.ts';
import { CCBillProcessor } from './processors/CCBillProcessor.ts';
import { NOWPaymentsProcessor } from './processors/NOWPaymentsProcessor.ts';
import { logger } from '../utils/logger.ts';

export class ProcessorFactory {
  static createProcessor(type: ProcessorType, config: ProcessorConfig): BaseProcessor {
    logger.info(`ProcessorFactory: Creating processor of type ${type}`);

    switch (type) {
      case 'STRIPE':
        return new StripeProcessor(config);
      
      case 'PAYMENTCLOUD':
        return new PaymentCloudProcessor(config);
      
      case 'SIGNATURE':
        return new SignatureProcessor(config);
      
      case 'CCBILL':
        return new CCBillProcessor(config);
      
      case 'NOWPAYMENTS':
        return new NOWPaymentsProcessor(config);
      
      default:
        throw new Error(`Unsupported processor type: ${type}`);
    }
  }

  static isProcessorAvailable(type: ProcessorType): boolean {
    try {
      const config: ProcessorConfig = {
        supabaseUrl: Deno.env.get('SUPABASE_URL') || '',
        supabaseKey: Deno.env.get('SUPABASE_ANON_KEY') || '',
      };

      const processor = this.createProcessor(type, config);
      
      // Check if processor has required credentials
      switch (type) {
        case 'STRIPE':
          return !!Deno.env.get('STRIPE_SECRET_KEY');
        
        case 'PAYMENTCLOUD':
          return !!Deno.env.get('PAYMENTCLOUD_API_KEY') && 
                 !!Deno.env.get('PAYMENTCLOUD_SECURITY_KEY');
        
        case 'SIGNATURE':
          return !!Deno.env.get('SIGNATURE_API_KEY') && 
                 !!Deno.env.get('SIGNATURE_API_LOGIN_ID') &&
                 !!Deno.env.get('SIGNATURE_TRANSACTION_KEY');
        
        case 'CCBILL':
          return !!Deno.env.get('CCBILL_ACCOUNT_NUMBER') &&
                 !!Deno.env.get('CCBILL_SUBACCOUNT_NUMBER') &&
                 !!Deno.env.get('CCBILL_FLEXFORMS_ID') &&
                 !!Deno.env.get('CCBILL_SALT_KEY');
        
        case 'NOWPAYMENTS':
          return !!Deno.env.get('NOWPAYMENTS_API_KEY') &&
                 !!Deno.env.get('NOWPAYMENTS_IPN_SECRET');
        
        default:
          return false;
      }
    } catch (error) {
      logger.error(`ProcessorFactory: Error checking processor availability`, { type, error });
      return false;
    }
  }
}
