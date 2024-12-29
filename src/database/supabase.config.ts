import { createClient } from '@supabase/supabase-js';
import { ConfigService } from '@nestjs/config';

export const createSupabaseClient = (configService: ConfigService) => {
  const supabaseUrl = configService.get<string>('SUPABASE_URL');
  const supabaseKey = configService.get<string>('SUPABASE_ANON_KEY');

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase configuration');
  }

  return createClient(supabaseUrl, supabaseKey, {
    db: {
      schema: configService.get('DB_SCHEMA', 'mainnet'),
    },
  });
};
