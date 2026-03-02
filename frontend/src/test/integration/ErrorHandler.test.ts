import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ErrorHandler, ErrorCode, AppError } from '@/lib/errors/ErrorHandler';
import toast from 'react-hot-toast';

vi.mock('react-hot-toast');

describe('ErrorHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getUserMessage', () => {
    it('should return user message from AppError', () => {
      const error = new AppError(
        ErrorCode.AUTH_INVALID_CREDENTIALS,
        'Technical message',
        {},
        'Custom user message'
      );
      
      const message = ErrorHandler.getUserMessage(error);
      expect(message).toBe('Custom user message');
    });

    it('should return default message for error code', () => {
      const error = new AppError(
        ErrorCode.NETWORK_ERROR,
        'Technical message'
      );
      
      const message = ErrorHandler.getUserMessage(error);
      expect(message).toBe('Network error. Please check your connection.');
    });

    it('should parse standard Error messages', () => {
      const error = new Error('Authentication failed');
      const message = ErrorHandler.getUserMessage(error);
      expect(message).toContain('Authentication');
    });

    it('should return generic message for unknown errors', () => {
      const message = ErrorHandler.getUserMessage({ weird: 'object' });
      expect(message).toBe('An unexpected error occurred. Please try again.');
    });
  });

  describe('getMessageForCode', () => {
    it('should return correct message for AUTH_INVALID_CREDENTIALS', () => {
      const message = ErrorHandler.getMessageForCode(ErrorCode.AUTH_INVALID_CREDENTIALS);
      expect(message).toBe('Invalid email or password');
    });

    it('should return correct message for S3_UPLOAD_FAILED', () => {
      const message = ErrorHandler.getMessageForCode(ErrorCode.S3_UPLOAD_FAILED);
      expect(message).toBe('File upload failed. Please try again.');
    });

    it('should return correct message for RLS_UNAUTHORIZED', () => {
      const message = ErrorHandler.getMessageForCode(ErrorCode.RLS_UNAUTHORIZED);
      expect(message).toBe('You do not have permission to access this resource');
    });
  });

  describe('parseErrorMessage', () => {
    it('should parse auth-related errors', () => {
      const message = ErrorHandler.parseErrorMessage('auth token expired');
      expect(message).toContain('Authentication');
    });

    it('should parse network-related errors', () => {
      const message = ErrorHandler.parseErrorMessage('network timeout');
      expect(message).toContain('Network');
    });

    it('should parse not-found errors', () => {
      const message = ErrorHandler.parseErrorMessage('resource not found');
      expect(message).toContain('not found');
    });

    it('should parse permission errors', () => {
      const message = ErrorHandler.parseErrorMessage('unauthorized access');
      expect(message).toContain('permission');
    });

    it('should return generic message for unrecognized errors', () => {
      const message = ErrorHandler.parseErrorMessage('some random error');
      expect(message).toBe('An error occurred. Please try again.');
    });
  });

  describe('handle', () => {
    it('should log error to console', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const error = new Error('Test error');
      
      ErrorHandler.handle(error, 'TestContext');
      
      expect(consoleSpy).toHaveBeenCalledWith('[TestContext]', error);
      consoleSpy.mockRestore();
    });

    it('should display toast notification', () => {
      const error = new AppError(
        ErrorCode.VALIDATION_ERROR,
        'Validation failed'
      );
      
      ErrorHandler.handle(error, 'TestContext');
      
      expect(toast.error).toHaveBeenCalledWith('Please check your input and try again');
    });

    it('should return the error', () => {
      const error = new Error('Test error');
      const result = ErrorHandler.handle(error, 'TestContext');
      expect(result).toBe(error);
    });
  });
});
