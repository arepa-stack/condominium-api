import { IBuildingPaymentInfoRepository } from '../../domain/repository';
import { PaymentInfo } from '../../domain/entities/PaymentInfo';
import { supabaseAdmin as supabase } from '@/infrastructure/supabase';
import { DomainError, NotFoundError } from '@/core/errors';

export class SupabaseBuildingPaymentInfoRepository implements IBuildingPaymentInfoRepository {
    async find(buildingId: string): Promise<PaymentInfo | null> {
        const { data, error } = await supabase
            .from('buildings')
            .select('payment_info')
            .eq('id', buildingId)
            .maybeSingle();

        if (error) throw new DomainError('Error fetching payment info: ' + error.message, 'DB_ERROR', 500);
        if (!data) throw new NotFoundError('Building not found');
        return (data.payment_info as PaymentInfo | null) ?? null;
    }

    async save(buildingId: string, info: PaymentInfo): Promise<void> {
        const { data, error } = await supabase
            .from('buildings')
            .update({ payment_info: info, updated_at: new Date() })
            .eq('id', buildingId)
            .select('id');

        if (error) throw new DomainError('Error saving payment info: ' + error.message, 'DB_ERROR', 500);
        if (!data?.length) throw new NotFoundError('Building not found');
    }
}
