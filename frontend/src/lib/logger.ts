/**
 * Structured Logging Utility
 * 
 * Provides type-safe logging with context, color-coding, and debug mode support.
 * Automatically sends errors to Sentry when configured.
 * Use this instead of console.log throughout the application.
 * 
 * Usage:
 *   import { logger } from '@/lib/logger';
 *   logger.info('HeatTimer', 'Heat started', { heatId: '123' });
 *   logger.error('API', 'Failed to fetch', { error });
 * 
 * Debug mode:
 *   - Add ?debug=true to URL
 *   - Or localStorage.setItem('debug', 'true')
 */

import * as Sentry from '@sentry/react';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
    level: LogLevel;
    context: string;
    message: string;
    data?: any;
    timestamp: string;
}

class Logger {
    private debugMode: boolean;

    constructor() {
        // Check for debug mode via localStorage or URL param
        this.debugMode = this.isDebugEnabled();

        if (this.debugMode) {
            console.log('🔧 Debug mode enabled');
        }
    }

    private isDebugEnabled(): boolean {
        // Check localStorage
        if (typeof localStorage !== 'undefined') {
            const localStorageDebug = localStorage.getItem('debug');
            if (localStorageDebug === 'true') {
                return true;
            }
        }

        // Check URL params
        if (typeof window !== 'undefined') {
            const urlParams = new URLSearchParams(window.location.search);
            if (urlParams.has('debug')) {
                return true;
            }
        }

        return false;
    }

    private log(level: LogLevel, context: string, message: string, data?: any): void {
        // Skip debug logs if not in debug mode
        if (level === 'debug' && !this.debugMode) {
            return;
        }

        const entry: LogEntry = {
            level,
            context,
            message,
            data,
            timestamp: new Date().toISOString(),
        };

        // Color-coded console output
        const colors = {
            debug: '🔍',
            info: '📋',
            warn: '⚠️',
            error: '🔴',
        };

        const icon = colors[level];
        const timestamp = new Date().toLocaleTimeString('fr-FR');

        // Format the log message
        const logMessage = `${icon} [${timestamp}] [${context}] ${message}`;

        // Output to console with appropriate method
        switch (level) {
            case 'debug':
                console.debug(logMessage, data || '');
                break;
            case 'info':
                console.info(logMessage, data || '');
                break;
            case 'warn':
                console.warn(logMessage, data || '');
                break;
            case 'error':
                console.error(logMessage, data || '');
                break;
        }

        // Store in global debug object if in debug mode
        if (this.debugMode) {
            if (typeof window !== 'undefined') {
                (window as any).__SURFJUDGING_DEBUG__ = (window as any).__SURFJUDGING_DEBUG__ || [];
                (window as any).__SURFJUDGING_DEBUG__.push(entry);

                // Keep only last 100 logs to avoid memory issues
                if ((window as any).__SURFJUDGING_DEBUG__.length > 100) {
                    (window as any).__SURFJUDGING_DEBUG__.shift();
                }
            }
        }

        // Send errors to Sentry
        if (level === 'error') {
            try {
                // If data is an Error object, send it directly
                if (data instanceof Error) {
                    Sentry.captureException(data, {
                        tags: { context },
                        extra: { message, timestamp: entry.timestamp },
                    });
                } else {
                    // Otherwise create a message with context
                    Sentry.captureMessage(`[${context}] ${message}`, {
                        level: 'error',
                        extra: { data, timestamp: entry.timestamp },
                        tags: { context },
                    });
                }
            } catch (sentryError) {
                // Silently fail if Sentry is not initialized
                console.debug('Sentry not available:', sentryError);
            }
        }
    }

    /**
     * Log debug information (only shown in debug mode)
     */
    debug(context: string, message: string, data?: any): void {
        this.log('debug', context, message, data);
    }

    /**
     * Log informational messages
     */
    info(context: string, message: string, data?: any): void {
        this.log('info', context, message, data);
    }

    /**
     * Log warnings
     */
    warn(context: string, message: string, data?: any): void {
        this.log('warn', context, message, data);
    }

    /**
     * Log errors
     */
    error(context: string, message: string, data?: any): void {
        this.log('error', context, message, data);
    }

    /**
     * Enable debug mode programmatically
     */
    enableDebugMode(): void {
        this.debugMode = true;
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem('debug', 'true');
        }
        console.log('🔧 Debug mode enabled');
    }

    /**
     * Disable debug mode programmatically
     */
    disableDebugMode(): void {
        this.debugMode = false;
        if (typeof localStorage !== 'undefined') {
            localStorage.removeItem('debug');
        }
        console.log('🔧 Debug mode disabled');
    }

    /**
     * Get all debug logs (only available in debug mode)
     */
    getDebugLogs(): LogEntry[] {
        if (typeof window !== 'undefined' && (window as any).__SURFJUDGING_DEBUG__) {
            return (window as any).__SURFJUDGING_DEBUG__;
        }
        return [];
    }

    /**
     * Clear all debug logs
     */
    clearDebugLogs(): void {
        if (typeof window !== 'undefined') {
            (window as any).__SURFJUDGING_DEBUG__ = [];
        }
    }
}

// Export singleton instance
export const logger = new Logger();

// Also export for use in window console
if (typeof window !== 'undefined') {
    (window as any).logger = logger;
}
