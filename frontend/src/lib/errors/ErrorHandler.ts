import toast from 'react-hot-toast';

export enum ErrorCode {
  AUTH_INVALID_CREDENTIALS = 'AUTH_INVALID_CREDENTIALS',
  AUTH_TOKEN_EXPIRED = 'AUTH_TOKEN_EXPIRED',
  AUTH_UNAUTHORIZED = 'AUTH_UNAUTHORIZED',
  NETWORK_ERROR = 'NETWORK_ERROR',
  NETWORK_TIMEOUT = 'NETWORK_TIMEOUT',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  VALIDATION_FILE_TOO_LARGE = 'VALIDATION_FILE_TOO_LARGE',
  VALIDATION_INVALID_FILE_TYPE = 'VALIDATION_INVALID_FILE_TYPE',
  DATABASE_ERROR = 'DATABASE_ERROR',
  DATABASE_NOT_FOUND = 'DATABASE_NOT_FOUND',
  DATABASE_CONSTRAINT_VIOLATION = 'DATABASE_CONSTRAINT_VIOLATION',
  S3_UPLOAD_FAILED = 'S3_UPLOAD_FAILED',
  S3_DELETE_FAILED = 'S3_DELETE_FAILED',
  RLS_UNAUTHORIZED = 'RLS_UNAUTHORIZED',
  RLS_VERIFICATION_REQUIRED = 'RLS_VERIFICATION_REQUIRED',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
  INTERNAL_ERROR = 'INTERNAL_ERROR'
}

export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public details?: unknown,
    public userMessage?: string
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class ErrorHandler {
  static handle(error: unknown, context: string) {
    console.error(`[${context}]`, error);
    
    if (import.meta.env.PROD) {
      this.logToService(error, context);
    }
    
    const userMessage = this.getUserMessage(error);
    toast.error(userMessage);
    
    return error;
  }
  
  static getUserMessage(error: unknown): string {
    if (error instanceof AppError && error.userMessage) {
      return error.userMessage;
    }
    
    if (error instanceof AppError) {
      return this.getMessageForCode(error.code);
    }
    
    if (error instanceof Error) {
      return this.parseErrorMessage(error.message);
    }
    
    return 'An unexpected error occurred. Please try again.';
  }
  
  static getMessageForCode(code: ErrorCode): string {
    const messages: Record<ErrorCode, string> = {
      [ErrorCode.AUTH_INVALID_CREDENTIALS]: 'Invalid email or password',
      [ErrorCode.AUTH_TOKEN_EXPIRED]: 'Your session has expired. Please log in again.',
      [ErrorCode.AUTH_UNAUTHORIZED]: 'You are not authorized to perform this action',
      [ErrorCode.NETWORK_ERROR]: 'Network error. Please check your connection.',
      [ErrorCode.NETWORK_TIMEOUT]: 'Request timed out. Please try again.',
      [ErrorCode.VALIDATION_ERROR]: 'Please check your input and try again',
      [ErrorCode.VALIDATION_FILE_TOO_LARGE]: 'File is too large. Maximum size is 5MB for images, 50MB for videos.',
      [ErrorCode.VALIDATION_INVALID_FILE_TYPE]: 'Invalid file type. Please upload JPG, PNG, WebP, GIF, or MP4 files.',
      [ErrorCode.DATABASE_ERROR]: 'Database error. Please try again.',
      [ErrorCode.DATABASE_NOT_FOUND]: 'The requested resource was not found',
      [ErrorCode.DATABASE_CONSTRAINT_VIOLATION]: 'This operation violates a database constraint',
      [ErrorCode.S3_UPLOAD_FAILED]: 'File upload failed. Please try again.',
      [ErrorCode.S3_DELETE_FAILED]: 'Failed to delete file. Please try again.',
      [ErrorCode.RLS_UNAUTHORIZED]: 'You do not have permission to access this resource',
      [ErrorCode.RLS_VERIFICATION_REQUIRED]: 'Account verification required. Please verify your account to continue.',
      [ErrorCode.UNKNOWN_ERROR]: 'An unexpected error occurred',
      [ErrorCode.INTERNAL_ERROR]: 'Internal server error. Please try again later.'
    };
    
    return messages[code] || messages[ErrorCode.UNKNOWN_ERROR];
  }
  
  static parseErrorMessage(message: string): string {
    const lowerMessage = message.toLowerCase();
    
    if (lowerMessage.includes('permission') || lowerMessage.includes('unauthorized')) {
      return 'You do not have permission to perform this action';
    }
    if (lowerMessage.includes('not found')) {
      return 'The requested resource was not found';
    }
    if (lowerMessage.includes('auth')) {
      return 'Authentication error. Please log in again.';
    }
    if (lowerMessage.includes('network') || lowerMessage.includes('fetch')) {
      return 'Network error. Please check your connection.';
    }
    
    return 'An error occurred. Please try again.';
  }
  
  static logToService(error: unknown, context: string) {
    const errorData = {
      timestamp: new Date().toISOString(),
      context,
      error: error instanceof Error ? {
        name: error.name,
        message: error.message,
        stack: error.stack
      } : error,
      userAgent: navigator.userAgent,
      url: window.location.href
    };
    
    console.log('[ErrorService]', errorData);
  }
}
