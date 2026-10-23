/**
 * src/types/creem.ts
 * 
 * Creem.io Webhook Datu Shēmas un Tipu Definīcijas.
 * Stingrs centu standarts: 'amount' TIKAI vesels skaitlis (integer USD cents).
 */

export interface CreemCustomer {
  id: string;
  email: string;
}

export interface CreemOrderData {
  id: string;
  order_id: string;
  customer: CreemCustomer;
  amount: number; // centos (integer)
  currency: 'USD' | 'EUR';
  custom_fields?: {
    key_id?: string;
    [key: string]: string | undefined;
  };
  metadata?: Record<string, string>;
}

export interface CreemWebhookPayload {
  id: string;
  event: 'checkout.completed';
  created_at: string;
  data: CreemOrderData;
}

export interface CreemWebhookResponse {
  success: boolean;
  message: string;
  idempotentDuplicate?: boolean;
  keyId?: string;
  tenantId?: string;
  addedCents?: number;
  newBalanceCents?: number;
  orderId?: string;
}
