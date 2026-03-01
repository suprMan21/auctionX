import type {
  PaymentProcessor,
  ProcessorResult,
  RefundResult,
  HealthCheckResult,
} from './types.ts';

export abstract class BaseProcessor implements PaymentProcessor {
  abstract readonly processorName: string;

  abstract processPayment(
    amount: number,
    currency: string,
    paymentMethod: any,
    metadata: Record<string, string>
  ): Promise<ProcessorResult>;

  abstract refund(
    transactionId: string,
    amount?: number,
    reason?: string
  ): Promise<RefundResult>;

  abstract healthCheck(): Promise<HealthCheckResult>;

  protected validateAmount(amount: number): void {
    if (!amount || amount <= 0) {
      throw new Error('Invalid amount: must be positive');
    }
    if (!Number.isInteger(amount)) {
      throw new Error('Invalid amount: must be in cents (integer)');
    }
  }

  protected validateCurrency(currency: string): void {
    const validCurrencies = ['USD', 'EUR', 'GBP', 'CAD', 'AUD'];
    if (!validCurrencies.includes(currency.toUpperCase())) {
      throw new Error(`Invalid currency: ${currency}`);
    }
  }
}
