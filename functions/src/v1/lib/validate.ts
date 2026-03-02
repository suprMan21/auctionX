import type { Request, Response, NextFunction } from "express";
import { z } from "zod";

/**
 * Express middleware to validate request body against Zod schema
 */
export function validateBody<T extends z.ZodTypeAny>(schema: T) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          error: "VALIDATION_ERROR",
          message: "Invalid request body",
          details: error.errors,
        });
      } else {
        res.status(500).json({ error: "INTERNAL_ERROR", message: "Validation failed" });
      }
    }
  };
}

/**
 * Validate query parameters
 */
export function validateQuery<T extends z.ZodTypeAny>(schema: T) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      req.query = schema.parse(req.query);
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          error: "VALIDATION_ERROR",
          message: "Invalid query parameters",
          details: error.errors,
        });
      } else {
        res.status(500).json({ error: "INTERNAL_ERROR", message: "Validation failed" });
      }
    }
  };
}

/**
 * Validate path parameters
 */
export function validateParams<T extends z.ZodTypeAny>(schema: T) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      req.params = schema.parse(req.params);
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          error: "VALIDATION_ERROR",
          message: "Invalid path parameters",
          details: error.errors,
        });
      } else {
        res.status(500).json({ error: "INTERNAL_ERROR", message: "Validation failed" });
      }
    }
  };
}
