import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseClient } from './supabase.config';

@Injectable()
export class DatabaseService {
  private readonly supabase: SupabaseClient;

  constructor(private configService: ConfigService) {
    this.supabase = createSupabaseClient(configService);
  }

  /**
   * Get the Supabase client instance
   */
  getClient(): SupabaseClient {
    return this.supabase;
  }

  /**
   * Generic query method for selecting data
   */
  async select<T>(
    table: string,
    query: {
      select?: string;
      eq?: Record<string, any>;
      or?: Array<Record<string, any>>;
      in?: Record<string, any[]>;
      gt?: Record<string, any>;
      lt?: Record<string, any>;
      gte?: Record<string, any>;
      lte?: Record<string, any>;
      order?: { column: string; ascending?: boolean };
      limit?: number;
      offset?: number;
    },
  ): Promise<T[]> {
    let queryBuilder = this.supabase.from(table).select(query.select || '*');

    // Apply filters
    if (query.eq) {
      Object.entries(query.eq).forEach(([column, value]) => {
        queryBuilder = queryBuilder.eq(column, value);
      });
    }

    if (query.or) {
      queryBuilder = queryBuilder.or(
        query.or
          .map((condition) =>
            Object.entries(condition)
              .map(([key, value]) => `${key}.eq.${value}`)
              .join(','),
          )
          .join(','),
      );
    }

    if (query.in) {
      Object.entries(query.in).forEach(([column, values]) => {
        queryBuilder = queryBuilder.in(column, values);
      });
    }

    if (query.gt) {
      Object.entries(query.gt).forEach(([column, value]) => {
        queryBuilder = queryBuilder.gt(column, value);
      });
    }

    if (query.lt) {
      Object.entries(query.lt).forEach(([column, value]) => {
        queryBuilder = queryBuilder.lt(column, value);
      });
    }

    if (query.gte) {
      Object.entries(query.gte).forEach(([column, value]) => {
        queryBuilder = queryBuilder.gte(column, value);
      });
    }

    if (query.lte) {
      Object.entries(query.lte).forEach(([column, value]) => {
        queryBuilder = queryBuilder.lte(column, value);
      });
    }

    // Apply ordering
    if (query.order) {
      queryBuilder = queryBuilder.order(query.order.column, {
        ascending: query.order.ascending ?? true,
      });
    }

    // Apply pagination
    if (query.limit) {
      queryBuilder = queryBuilder.limit(query.limit);
    }

    if (query.offset) {
      queryBuilder = queryBuilder.range(
        query.offset,
        query.offset + (query.limit || 10) - 1,
      );
    }

    const { data, error } = await queryBuilder;

    if (error) {
      throw error;
    }

    return data as T[];
  }

  /**
   * Insert data into a table
   */
  async insert<T>(
    table: string,
    data: Partial<T> | Partial<T>[],
  ): Promise<T[]> {
    const { data: result, error } = await this.supabase
      .from(table)
      .insert(data)
      .select();

    if (error) {
      throw error;
    }

    return result as T[];
  }

  /**
   * Update data in a table
   */
  async update<T>(
    table: string,
    data: Partial<T>,
    match: Record<string, any>,
  ): Promise<T[]> {
    const { data: result, error } = await this.supabase
      .from(table)
      .update(data)
      .match(match)
      .select();

    if (error) {
      throw error;
    }

    return result as T[];
  }

  /**
   * Delete data from a table
   */
  async delete(table: string, match: Record<string, any>): Promise<void> {
    const { error } = await this.supabase.from(table).delete().match(match);

    if (error) {
      throw error;
    }
  }

  /**
   * Execute a raw query
   */
  async raw<T>(query: string, params?: any[]): Promise<T[]> {
    const { data, error } = await this.supabase.rpc('execute_sql', {
      query_text: query,
      query_params: params,
    });

    if (error) {
      throw error;
    }

    return data as T[];
  }
}
