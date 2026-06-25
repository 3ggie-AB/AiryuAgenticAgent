/**
 * Payment Service - handles payment processing
 */

export interface PaymentIntent {
  id: string;
  amount: number;
  currency: string;
  status: "pending" | "completed" | "failed" | "refunded";
  userId: string;
  metadata?: Record<string, string>;
}

export interface PaymentResult {
  success: boolean;
  transactionId: string;
  intent: PaymentIntent;
}

/**
 * Create a new payment intent for a user purchase.
 */
export async function createPaymentIntent(
  userId: string,
  amount: number,
  currency: string = "USD"
): Promise<PaymentIntent> {
  const intent: PaymentIntent = {
    id: `pi_${Date.now()}`,
    amount,
    currency,
    status: "pending",
    userId,
  };

  await PaymentRepository.save(intent);
  return intent;
}

/**
 * Process a payment using Stripe.
 * Validates the payment method and charges the user.
 */
export async function processPayment(
  intentId: string,
  paymentMethodId: string
): Promise<PaymentResult> {
  const intent = await PaymentRepository.findById(intentId);
  if (!intent) throw new Error("Payment intent not found");

  // Call payment gateway
  const result = await StripeGateway.charge({
    amount: intent.amount,
    currency: intent.currency,
    paymentMethodId,
  });

  intent.status = result.success ? "completed" : "failed";
  await PaymentRepository.save(intent);

  if (result.success) {
    await NotificationService.sendPaymentConfirmation(intent.userId, intent);
  }

  return { success: result.success, transactionId: result.transactionId, intent };
}

/**
 * Refund a completed payment.
 */
export async function refundPayment(intentId: string, reason?: string): Promise<boolean> {
  const intent = await PaymentRepository.findById(intentId);
  if (!intent || intent.status !== "completed") return false;

  const refunded = await StripeGateway.refund(intentId, reason);
  if (refunded) {
    intent.status = "refunded";
    await PaymentRepository.save(intent);
  }

  return refunded;
}

// Stubs
const PaymentRepository = {
  save: async (intent: PaymentIntent) => {},
  findById: async (id: string): Promise<PaymentIntent | null> => null,
};

const StripeGateway = {
  charge: async (params: any) => ({ success: true, transactionId: "txn_123" }),
  refund: async (intentId: string, reason?: string) => true,
};

const NotificationService = {
  sendPaymentConfirmation: async (userId: string, intent: PaymentIntent) => {},
};
