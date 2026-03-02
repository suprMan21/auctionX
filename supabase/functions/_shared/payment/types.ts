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
  
  // Card details
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
