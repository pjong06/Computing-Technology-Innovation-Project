
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { recentIotQuery } = require('../src/services/recentIotQuery');

test('history query preserves columns, ordering, pagination and sanitized errors', async () => {
  for (const mode of ['ok', 'error', 'throw']) {
    const calls = [];
    let status = 200;
    let body;

    const db = {
      from(table) {
        calls.push(table);

        return {
          select(columns) {
            calls.push(columns);

            return {
              order(field, options) {
                calls.push(['order', field, options]);
                return this;
              },

              async range(start, end) {
                calls.push(['range', start, end]);

                if (mode === 'throw') {
                  throw new Error('private details');
                }

                return mode === 'error'
                  ? { error: { message: 'private details' } }
                  : { data: [{ id: 'fixture' }] };
              }
            };
          }
        };
      }
    };

    const res = {
      status(code) {
        status = code;
        return this;
      },

      json(value) {
        body = value;
        return this;
      }
    };

    await recentIotQuery({
      table: 'sensor_readings',
      columns: 'id,received_at',
      orderBy: 'recorded_at',
      message: 'Success',
      failure: 'Query unavailable'
    })(
      { supabase: db, query: {} },
      res
    );

    assert.deepEqual(calls, [
      'sensor_readings',
      'id,received_at',
      ['order', 'recorded_at', { ascending: false }],
      ['order', 'id', { ascending: false }],
      ['range', 0, 99]
    ]);

    assert.equal(status, mode === 'ok' ? 200 : 500);
    assert.doesNotMatch(JSON.stringify(body), /private details/);

    if (mode === 'ok') {
      assert.deepEqual(body, {
        message: 'Success',
        data: [{ id: 'fixture' }],
        pagination: {
          page: 1,
          page_size: 100
        }
      });
    }
  }
});
