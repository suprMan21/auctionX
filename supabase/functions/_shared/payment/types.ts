export type ProcessorType = 
  | 'STRIPE'
  | 'PAYMENTCLOUD'
  | 'SIGNATURE'
  | 'CCBILL'
  | 'NOWPAYMENTS';

export enum PaymentStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  REFUNDED = 'REFUNDED',
  CANCELLED = 'CANCELLED',
}

export interface PaymentMethod {
  type: 'CARD' | 'BANK' | 'CRYPTO' | 'OTHER';

  // Tokenized payment method id (Stripe pm_*, etc.). When set, processors use
  // it directly and skip raw-card fields. Required by Stripe in prod; in test
  // mode Stripe also accepts predefined tokens like 'pm_card_visa'.
  paymentMethodId?: string;

  // Card details (legacy raw-card path; Stripe rejects unless raw card access
  // is enabled on the account)
  cardNumber?: string;
  cardExpiry?: string;
  cardCvv?: string;
  
  // Bank details
  accountNumber?: string;
  routingNumber?: string;
  
  // Crypto details
  cryptoCurrency?: string;
  walletAddress?: string;
  
  // Billing info
  billingName?: string;
  email?: string;
  billingAddress?: {
    line1: string;
    line2?: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  };
}

export interface PaymentRequest {
  amount: number;
  currency: string;
  paymentMethod: PaymentMethod;
  metadata: Record<string, unknown>;
}

export interface PaymentResponse {
  success: boolean;
  transactionId?: string;
  status: PaymentStatus;
  amount: number;
  currency: string;
  error?: string;
  processorResponse?: unknown;
}

export interface ProcessorConfig {
  supabaseUrl: string;
  supabaseKey: string;
}

export interface RiskAssessment {
  level: 'LOW' | 'MEDIUM' | 'HIGH';
  flags: string[];
  score: number;
}

export interface ProcessorResult {
  success: boolean;
  transactionId?: string;
  processor: string;
  amount?: number;
  currency?: string;
  metadata?: Record<string, string>;
  errorMessage?: string;
  errorCode?: string;
}

export interface RefundResult {
  success: boolean;
  refundId?: string;
  processor: string;
  amount?: number;
  status?: string;
  errorMessage?: string;
}

export interface HealthCheckResult {
  healthy: boolean;
  processor: string;
  errorMessage?: string;
}

export interface PaymentProcessor {
  readonly processorName: string;
  processPayment(
    amount: number,
    currency: string,
    paymentMethod: PaymentMethod,
    metadata: Record<string, string>
  ): Promise<ProcessorResult>;
  refund(
    transactionId: string,
    amount?: number,
    reason?: string
  ): Promise<RefundResult>;
  healthCheck(): Promise<HealthCheckResult>;
}

export interface PaymentIntent {
  id: string;
  amount: number;
  currency: string;
  status: string;
  metadata?: Record<string, string>;
}
