import { z } from 'zod';

export const intelligentSearchSchema = z.object({
  term: z.string().min(1, 'Search term is required'),
  maxresults: z.number().int().positive().default(100),
  buckets: z.array(z.string()).optional(),
  timeout: z.number().int().positive().default(5),
  datefrom: z.string().optional(),
  dateto: z.string().optional(),
  sort: z.number().int().min(0).max(4).default(4),
  media: z.number().int().min(0).default(0),
  terminate: z.array(z.string()).optional()
});

export const phonebookSearchSchema = z.object({
  term: z.string().min(1, 'Search term is required'),
  maxresults: z.number().int().positive().default(100),
  buckets: z.array(z.string()).optional(),
  timeout: z.number().int().positive().default(5),
  datefrom: z.string().optional(),
  dateto: z.string().optional(),
  sort: z.number().int().min(0).max(4).default(4),
  media: z.number().int().min(0).default(0),
  terminate: z.array(z.string()).optional(),
  target: z.enum(['all', 'domains', 'emails', 'urls']).default('all')
});

export const terminateSearchSchema = z.object({
  search_id: z.string().uuid('Invalid search ID format')
});

export const filePreviewSchema = z.object({
  storage_id: z.string().min(1, 'Storage ID is required'),
  bucket: z.string().min(1, 'Bucket is required'),
  media_type: z.number().int().min(0),
  content_type: z.number().int().min(0),
  lines: z.number().int().positive().default(8),
  format: z.enum(['text', 'picture']).default('text')
});

export const fileViewSchema = z.object({
  storage_id: z.string().min(1, 'Storage ID is required'),
  bucket: z.string().min(1, 'Bucket is required'),
  media_type: z.number().int().min(0),
  content_type: z.number().int().min(0)
});

export const fileReadSchema = z.object({
  system_id: z.string().min(1, 'System ID is required'),
  bucket: z.string().min(1, 'Bucket is required'),
  filename: z.string().optional()
});

export const fileTreeViewSchema = z.object({
  bucket: z.string().min(1, 'Bucket is required'),
  storage_id: z.string().optional(),
  system_id: z.string().optional()
}).refine(data => data.storage_id || data.system_id, {
  message: 'Either storage_id or system_id must be provided'
});

export const getSelectorsSchema = z.object({
  system_id: z.string().min(1, 'System ID is required')
});

export const identitySearchSchema = z.object({
  selector: z.string().min(1, 'Selector is required'),
  maxresults: z.number().int().positive().default(100),
  buckets: z.string().optional(),
  datefrom: z.string().optional(),
  dateto: z.string().optional(),
  analyze: z.boolean().default(false),
  skip_invalid: z.boolean().default(false),
  terminate: z.array(z.string()).optional()
});

export const exportAccountsSchema = z.object({
  selector: z.string().min(1, 'Selector is required'),
  maxresults: z.number().int().positive().default(100),
  buckets: z.string().optional(),
  datefrom: z.string().optional(),
  dateto: z.string().optional(),
  terminate: z.array(z.string()).optional()
});

