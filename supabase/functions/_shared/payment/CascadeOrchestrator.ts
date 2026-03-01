import { ProcessorFactory } from './ProcessorFactory.ts';
import { BaseProcessor } from './BaseProcessor.ts';
import {
  ProcessorType,
  PaymentRequest,
  PaymentResponse,
  PaymentStatus,
  RiskAssessment,
  ProcessorConfig,
} from './types.ts';
import { logger } from '../utils/logger.ts';

export class CascadeOrchestrator {
  private config: ProcessorConfig;
  
  // Processor priority by risk level
  private readonly processorCascade: Record<string, ProcessorType[]> = {
    LOW: ['STRIPE', 'PAYMENTCLOUD', 'SIGNATURE', 'CCBILL', 'NOWPAYMENTS'],
    MEDIUM: ['PAYMENTCLOUD', 'SIGNATURE', 'CCBILL', 'NOWPAYMENTS', 'STRIPE'],
    HIGH: ['SIGNATURE', 'CCBILL', 'NOWPAYMENTS', 'PAYMENTCLOUD', 'STRIPE'],
  };

  constructor(config: ProcessorConfig) {
    this.config = config;
  }

  async processPayment(request: PaymentRequest): Promise<PaymentResponse> {
    try {
      // Assess risk based on listing flags
      const riskAssessment = this.assessRisk(request.metadata);
      
      logger.info('CascadeOrchestrator: Risk assessment complete', {
        level: riskAssessment.level,
        flags: riskAssessment.flags,
        score: riskAssessment.score,
      });

      // Get processor cascade for this risk level
      const processorOrder = this.processorCascade[riskAssessment.level];

      // Try processors in order until one succeeds
      for (const processorType of processorOrder) {
        // Check if processor is available (has credentials)
        if (!ProcessorFactory.isProcessorAvailable(processorType)) {
          logger.warn(`CascadeOrchestrator: Processor ${processorType} not available, skipping`);
          continue;
        }

        logger.info(`CascadeOrchestrator: Attempting processor ${processorType}`);

        try {
          const processor = ProcessorFactory.createProcessor(processorType, this.config);
          
          const result = await processor.processPayment(
            request.amount,
            request.currency,
            request.paymentMethod,
            request.metadata
          );

          // If successful, return result
          if (result.success) {
            logger.info(`CascadeOrchestrator: Payment successful with ${processorType}`, {
              transactionId: result.transactionId,
            });
            
            return {
              ...result,
              processorResponse: {
                ...result.processorResponse,
                selectedProcessor: processorType,
                riskAssessment,
              },
            };
          }

          // If processor declined (not error), try next processor
          if (result.status === PaymentStatus.FAILED) {
            logger.warn(`CascadeOrchestrator: Processor ${processorType} declined payment, trying next`);
            continue;
          }

          // If pending (like CCBill/NOWPayments), return immediately
          if (result.status === PaymentStatus.PENDING) {
            logger.info(`CascadeOrchestrator: Payment pending with ${processorType}`);
            return {
              ...result,
              processorResponse: {
                ...result.processorResponse,
                selectedProcessor: processorType,
                riskAssessment,
              },
            };
          }

        } catch (processorError) {
          logger.error(`CascadeOrchestrator: Processor ${processorType} error`, {
            error: processorError,
          });
          continue;
        }
      }

      // All processors failed
      logger.error('CascadeOrchestrator: All processors failed');
      
      return {
        success: false,
        error: 'Payment could not be processed. Please try a different payment method.',
        status: PaymentStatus.FAILED,
        amount: request.amount,
        currency: request.currency,
      };

    } catch (error) {
      logger.error('CascadeOrchestrator: Orchestration error', { error });
      
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Payment processing failed',
        status: PaymentStatus.FAILED,
        amount: request.amount,
        currency: request.currency,
      };
    }
  }

  private assessRisk(metadata: Record<string, unknown>): RiskAssessment {
    const flags: string[] = [];
    let score = 0;

    // Extract content flags from metadata
    const contentFlags = (metadata.contentFlags as string[]) || [];

    // Low-risk flags (score: 1-2)
    if (contentFlags.includes('CREATOR_MERCH')) {
      flags.push('CREATOR_MERCH');
      score += 1;
    }

    if (contentFlags.includes('GAMING')) {
      flags.push('GAMING');
      score += 1;
    }

    if (contentFlags.includes('COSPLAY')) {
      flags.push('COSPLAY');
      score += 2;
    }

    // Medium-risk flags (score: 3-5)
    if (contentFlags.includes('SWIMWEAR')) {
      flags.push('SWIMWEAR');
      score += 3;
    }

    if (contentFlags.includes('LINGERIE')) {
      flags.push('LINGERIE');
      score += 4;
    }

    if (contentFlags.includes('PERSONAL_ITEM')) {
      flags.push('PERSONAL_ITEM');
      score += 5;
    }

    // High-risk flags (score: 6+)
    if (contentFlags.includes('ADULT_CONTENT')) {
      flags.push('ADULT_CONTENT');
      score += 8;
    }

    if (contentFlags.includes('EXPLICIT')) {
      flags.push('EXPLICIT');
      score += 10;
    }

    if (contentFlags.includes('FETISH')) {
      flags.push('FETISH');
      score += 10;
    }

    // Determine risk level
    let level: 'LOW' | 'MEDIUM' | 'HIGH';
    
    if (score === 0) {
      level = 'LOW';
    } else if (score <= 5) {
      level = 'MEDIUM';
    } else {
      level = 'HIGH';
    }

    return { level, flags, score };
  }

  // Get recommended processor for a given risk level
  getRecommendedProcessor(riskLevel: 'LOW' | 'MEDIUM' | 'HIGH'): ProcessorType | null {
    const processors = this.processorCascade[riskLevel];
    
    for (const processorType of processors) {
      if (ProcessorFactory.isProcessorAvailable(processorType)) {
        return processorType;
      }
    }
    
    return null;
  }

  // Get all available processors
  getAvailableProcessors(): ProcessorType[] {
    const allProcessors: ProcessorType[] = [
      'STRIPE',
      'PAYMENTCLOUD',
      'SIGNATURE',
      'CCBILL',
      'NOWPAYMENTS',
    ];

    return allProcessors.filter(type => 
      ProcessorFactory.isProcessorAvailable(type)
    );
  }
}
