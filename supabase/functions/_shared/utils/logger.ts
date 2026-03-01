export const logger = {
  info: (message: string, meta?: Record<string, unknown>) => {
    console.log(JSON.stringify({ 
      level: 'info', 
      message, 
      timestamp: new Date().toISOString(),
      ...meta 
    }));
  },
  
  error: (message: string, error?: Error, meta?: Record<string, unknown>) => {
    console.error(JSON.stringify({ 
      level: 'error', 
      message, 
      error: error?.message,
      stack: error?.stack,
      timestamp: new Date().toISOString(),
      ...meta 
    }));
  },
  
  warn: (message: string, meta?: Record<string, unknown>) => {
    console.warn(JSON.stringify({ 
      level: 'warn', 
      message, 
      timestamp: new Date().toISOString(),
      ...meta 
    }));
  }
};
