/**
 * Base Repository
 * 
 * Abstract base class for all data repositories.
 * Provides common functionality for Supabase operations, error handling, and offline support.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { logger } from '../lib/logger';

export interface RepositoryOptions {
    enableOffline?: boolean;
    tableName?: string;
}

/**
 * Abstract base repository class
 * All domain repositories should extend this class
 */
export abstract class BaseRepository {
    protected supabase: SupabaseClient | null;
    protected tableName: string;
    protected enableOffline: boolean;

    constructor(tableName: string, options: RepositoryOptions = {}) {
        this.supabase = supabase;
        this.tableName = tableName;
        this.enableOffline = options.enableOffline ?? true;
    }

    /**
     * Check if Supabase is configured and online
     */
    protected get isOnline(): boolean {
        return navigator.onLine && isSupabaseConfigured() && this.supabase !== null;
    }

    /**
     * Execute a Supabase operation with error handling and offline fallback
     * 
     * @param operation - The Supabase operation to execute
     * @param fallback - Optional fallback function for offline mode
     * @param operationName - Name of the operation for logging
     */
    protected async execute<T>(
        operation: () => Promise<T>,
        fallback?: () => T | Promise<T>,
        operationName: string = 'operation'
    ): Promise<T> {
        const repoName = this.constructor.name;

        try {
            // If offline and fallback provided, use fallback
            if (!this.isOnline && fallback) {
                logger.info(repoName, `${operationName} - Using offline fallback`);
                return await Promise.resolve(fallback());
            }

            // If offline and no fallback, throw error
            if (!this.isOnline) {
                throw new Error('Offline and no fallback provided');
            }

            // Execute online operation
            logger.debug(repoName, `${operationName} - Executing online`);
            const result = await operation();
            logger.debug(repoName, `${operationName} - Success`);
            return result;

        } catch (error) {
            logger.error(repoName, `${operationName} - Failed`, error);

            // Try fallback on error if provided
            if (fallback) {
                logger.info(repoName, `${operationName} - Using fallback after error`);
                return await Promise.resolve(fallback());
            }

            throw error;
        }
    }

    /**
     * Ensure Supabase is configured, throw error if not
     */
    protected ensureSupabase(): void {
        if (!this.supabase || !isSupabaseConfigured()) {
            throw new Error('Supabase is not configured');
        }
    }

    /**
     * Generate a UUID for new records
     */
    protected generateId(): string {
        if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
            return crypto.randomUUID();
        }
        // Fallback UUID-ish generator
        const ts = Date.now().toString(16).padStart(12, '0');
        const rand = Math.floor(Math.random() * 0xffff)
            .toString(16)
            .padStart(4, '0');
        return `00000000-0000-4000-${rand}-${ts}`;
    }

    /**
     * Get current timestamp in ISO format
     */
    protected now(): string {
        return new Date().toISOString();
    }
}
