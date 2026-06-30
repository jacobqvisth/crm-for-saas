import { describe, expect, it } from 'vitest';

import { parseNameFromEmail } from './parse-name-from-email';

describe('parseNameFromEmail', () => {
  it('parses the canonical firstname.lastname shape', () => {
    expect(parseNameFromEmail('timo.larsson@icloud.com')).toEqual({
      firstName: 'Timo',
      lastName: 'Larsson',
    });
  });

  it('handles underscore and hyphen separators', () => {
    expect(parseNameFromEmail('anna_svensson@example.com')).toEqual({
      firstName: 'Anna',
      lastName: 'Svensson',
    });
    expect(parseNameFromEmail('erik-berg@example.com')).toEqual({
      firstName: 'Erik',
      lastName: 'Berg',
    });
  });

  it('is case-insensitive and capitalizes output', () => {
    expect(parseNameFromEmail('JOHN.DOE@EXAMPLE.COM')).toEqual({
      firstName: 'John',
      lastName: 'Doe',
    });
  });

  it('strips a +tag suffix', () => {
    expect(parseNameFromEmail('timo.larsson+crm@icloud.com')).toEqual({
      firstName: 'Timo',
      lastName: 'Larsson',
    });
  });

  it('keeps Nordic / accented letters', () => {
    expect(parseNameFromEmail('jörgen.åkesson@example.se')).toEqual({
      firstName: 'Jörgen',
      lastName: 'Åkesson',
    });
  });

  it('rejects role / functional inboxes', () => {
    expect(parseNameFromEmail('info@example.com')).toBeNull();
    expect(parseNameFromEmail('sales.team@example.com')).toBeNull();
    expect(parseNameFromEmail('kundservice@example.se')).toBeNull();
  });

  it('rejects single-letter initials', () => {
    expect(parseNameFromEmail('j.larsson@example.com')).toBeNull();
  });

  it('rejects tokens containing digits', () => {
    expect(parseNameFromEmail('user12.test34@example.com')).toBeNull();
    expect(parseNameFromEmail('john.doe2@example.com')).toBeNull();
  });

  it('rejects single-token and three-token locals', () => {
    expect(parseNameFromEmail('timo@example.com')).toBeNull();
    expect(parseNameFromEmail('first.middle.last@example.com')).toBeNull();
  });

  it('rejects empty / malformed input', () => {
    expect(parseNameFromEmail(null)).toBeNull();
    expect(parseNameFromEmail(undefined)).toBeNull();
    expect(parseNameFromEmail('')).toBeNull();
    expect(parseNameFromEmail('@example.com')).toBeNull();
    expect(parseNameFromEmail('not-an-email')).toBeNull();
  });
});
