import { describe, test, expect, beforeAll } from 'bun:test';
import { IntelXClient } from '../lib/intelx-client';
import { IdentityClient } from '../lib/identity-client';

const API_KEY = process.env.INTELX_API_KEY || '';

if (!API_KEY) {
  throw new Error('INTELX_API_KEY environment variable is required for tests');
}

describe('IntelX API Client', () => {
  let client: IntelXClient;

  beforeAll(() => {
    client = new IntelXClient(API_KEY);
  });

  describe('Capabilities', () => {
    test('should get API capabilities and account info', async () => {
      const capabilities = await client.getCapabilities();
      
      expect(capabilities).toBeDefined();
      expect(typeof capabilities).toBe('object');
      // API returns various capability information
      // Structure may vary, so just verify we get a response
      expect(Object.keys(capabilities).length).toBeGreaterThan(0);
    }, 15000);
  });

  describe('Intelligent Search', () => {
    test('should search for email in pastes', async () => {
      const results = await client.search({
        term: 'test@example.com',
        buckets: ['pastes'],
        maxresults: 5,
        timeout: 10
      });

      expect(results).toBeDefined();
      expect(results.status).toBeDefined();
      expect(Array.isArray(results.records)).toBe(true);
    }, 30000);

    test('should search for domain across multiple buckets', async () => {
      const results = await client.search({
        term: 'github.com',
        buckets: ['pastes', 'web.public'],
        maxresults: 3,
        timeout: 10
      });

      expect(results).toBeDefined();
      expect(results.status).toBe(0);
    }, 30000);

    test('should search in leaks.logs bucket', async () => {
      const results = await client.search({
        term: 'gmail.com',
        buckets: ['leaks.logs'],
        maxresults: 2,
        timeout: 10
      });

      expect(results).toBeDefined();
      expect(results.status).toBe(0);
    }, 30000);

    test('should handle invalid bucket gracefully', async () => {
      try {
        await client.search({
          term: 'test@example.com',
          buckets: ['invalid_bucket_name'],
          maxresults: 1,
          timeout: 5
        });
        expect(false).toBe(true); // Should not reach here
      } catch (error) {
        expect(error).toBeDefined();
        expect((error as Error).message).toContain('401');
      }
    }, 20000);
  });

  describe('Phonebook Search', () => {
    test('should find emails for a domain', async () => {
      const results = await client.phonebookSearchComplete({
        term: 'github.com',
        target: 'emails',
        maxresults: 5,
        timeout: 10
      });

      expect(Array.isArray(results)).toBe(true);
      if (results.length > 0 && results[0]?.selectors) {
        expect(Array.isArray(results[0].selectors)).toBe(true);
      }
    }, 30000);

    test('should find domains related to search term', async () => {
      const results = await client.phonebookSearchComplete({
        term: '@gmail.com',
        target: 'domains',
        maxresults: 5,
        timeout: 10
      });

      expect(Array.isArray(results)).toBe(true);
    }, 30000);

    test('should search all selector types', async () => {
      const results = await client.phonebookSearchComplete({
        term: 'example.com',
        target: 'all',
        maxresults: 5,
        timeout: 10
      });

      expect(Array.isArray(results)).toBe(true);
    }, 30000);
  });

  describe('File Operations', () => {
    let testSystemId: string;
    let testStorageId: string;
    let testBucket: string;
    let testMediaType: number;
    let testContentType: number;

    beforeAll(async () => {
      // Get a real file from search results
      const searchResults = await client.search({
        term: 'test@example.com',
        buckets: ['pastes'],
        maxresults: 1,
        timeout: 10
      });

      if (searchResults.records && searchResults.records.length > 0) {
        const record = searchResults.records[0];
        if (record) {
          testSystemId = record.systemid;
          testStorageId = record.storageid;
          testBucket = record.bucket;
          testMediaType = record.media;
          testContentType = record.type;
        }
      }
    }, 30000);

    test('should preview file content', async () => {
      if (!testStorageId) {
        console.log('Skipping test: no test file available');
        return;
      }

      const preview = await client.filePreview(
        testStorageId,
        testBucket,
        testMediaType,
        testContentType,
        5
      );

      expect(typeof preview).toBe('string');
      expect(preview.length).toBeGreaterThan(0);
    }, 15000);

    test('should view full file content', async () => {
      if (!testStorageId) {
        console.log('Skipping test: no test file available');
        return;
      }

      const content = await client.fileView(
        testStorageId,
        testBucket,
        testMediaType,
        testContentType
      );

      expect(typeof content).toBe('string');
      expect(content.length).toBeGreaterThan(0);
    }, 15000);

    test('should read binary file', async () => {
      if (!testSystemId) {
        console.log('Skipping test: no test file available');
        return;
      }

      const binary = await client.fileRead(testSystemId, testBucket);

      expect(binary).toBeDefined();
      expect(binary instanceof ArrayBuffer).toBe(true);
    }, 15000);

    test('should extract selectors from file', async () => {
      if (!testSystemId) {
        console.log('Skipping test: no test file available');
        return;
      }

      const selectors = await client.getSelectors(testSystemId);

      expect(Array.isArray(selectors)).toBe(true);
    }, 15000);
  });

  describe('File Tree View', () => {
    test('should get tree view for stealer log archive', async () => {
      // Search for stealer logs
      const results = await client.search({
        term: 'gmail.com',
        buckets: ['leaks.logs'],
        maxresults: 1,
        timeout: 10
      });

      if (results.records && results.records.length > 0) {
        const record = results.records[0];
        if (record?.indexfile) {
          const tree = await client.fileTreeView(record.bucket, record.indexfile);
          
          expect(Array.isArray(tree)).toBe(true);
          if (tree.length > 0) {
            expect(tree[0]?.systemid).toBeDefined();
            expect(tree[0]?.name).toBeDefined();
          }
        }
      }
    }, 30000);
  });

  describe('Search Termination', () => {
    test('should terminate an ongoing search', async () => {
      const searchId = await client.intelligentSearch({
        term: 'test@example.com',
        buckets: ['pastes'],
        maxresults: 100,
        timeout: 30
      });

      expect(typeof searchId).toBe('string');
      expect(searchId.length).toBeGreaterThan(0);

      const terminated = await client.terminateSearch(searchId);
      expect(typeof terminated).toBe('boolean');
    }, 20000);
  });

  describe('Search Statistics', () => {
    test('should calculate search statistics by bucket', () => {
      const records = [
        { bucket: 'pastes', systemid: '1', name: 'test1' },
        { bucket: 'pastes', systemid: '2', name: 'test2' },
        { bucket: 'leaks.public', systemid: '3', name: 'test3' },
        { bucket: 'web.public', systemid: '4', name: 'test4' },
        { bucket: 'web.public', systemid: '5', name: 'test5' }
      ];

      const stats = client.searchStats(records);

      expect(stats.pastes).toBe(2);
      expect(stats['leaks.public']).toBe(1);
      expect(stats['web.public']).toBe(2);
    });
  });
});

describe('IntelX Identity Service', () => {
  let client: IdentityClient;

  beforeAll(() => {
    client = new IdentityClient(API_KEY);
  });

  describe('Identity Search', () => {
    test('should search for breached email', async () => {
      const results = await client.search({
        selector: 'test@example.com',
        limit: 5
      });

      expect(results).toBeDefined();
      expect(Array.isArray(results)).toBe(true);
    }, 30000);

    test('should search for domain breaches', async () => {
      const results = await client.search({
        selector: '@gmail.com',
        limit: 3
      });

      expect(results).toBeDefined();
      expect(Array.isArray(results)).toBe(true);
    }, 30000);

    test('should search with date range', async () => {
      const results = await client.search({
        selector: 'test@example.com',
        limit: 5,
        datefrom: '2020-01-01 00:00:00',
        dateto: '2024-12-31 23:59:59'
      });

      expect(results).toBeDefined();
      expect(Array.isArray(results)).toBe(true);
    }, 30000);
  });

  describe('Account Export', () => {
    test('should export leaked accounts', async () => {
      const results = await client.exportAccounts('test@example.com', 5);

      expect(results).toBeDefined();
      expect(Array.isArray(results)).toBe(true);
    }, 30000);

    test('should export domain accounts', async () => {
      const results = await client.exportAccounts('@gmail.com', 3);

      expect(results).toBeDefined();
      expect(Array.isArray(results)).toBe(true);
    }, 45000);

    test('should include password types in export', async () => {
      const results = await client.exportAccounts('test@example.com', 10);

      expect(results).toBeDefined();
      expect(Array.isArray(results)).toBe(true);
      
      // Check if we got results with password information
      if (results.length > 0) {
        const account = results[0];
        if (account) {
          expect(account.user).toBeDefined();
          expect(account.password).toBeDefined();
        }
      }
    }, 30000);
  });
});

