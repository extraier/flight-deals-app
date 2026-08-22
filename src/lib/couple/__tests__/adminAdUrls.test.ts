import {
  safeAdminAdBackgroundImage,
  safeAdminAdPreviewUrl,
} from '../adminAdUrls';

describe('admin ad URL guards', () => {
  test.each([
    [undefined],
    [null],
    [''],
    ['   '],
    ['undefined'],
    ['/match/undefined'],
    ['relative-banner.webp'],
    ['javascript:alert(1)'],
    ['data:text/plain,unsafe'],
  ])('rejects unsafe image value %p', (value) => {
    expect(safeAdminAdBackgroundImage(value)).toBeUndefined();
  });

  test('returns a quoted CSS image URL only for an absolute HTTPS image', () => {
    expect(safeAdminAdBackgroundImage('https://cdn.example.com/banner.webp'))
      .toBe('url("https://cdn.example.com/banner.webp")');
  });

  test.each([
    [undefined],
    [''],
    ['undefined'],
    ['/match/undefined'],
    ['mailto:partner@example.com'],
    ['javascript:alert(1)'],
  ])('disables unsafe preview URL %p', (value) => {
    expect(safeAdminAdPreviewUrl(value)).toBeNull();
  });

  test('keeps an absolute HTTP(S) preview URL', () => {
    expect(safeAdminAdPreviewUrl('https://partner.example/deal'))
      .toBe('https://partner.example/deal');
    expect(safeAdminAdPreviewUrl('http://partner.example/deal'))
      .toBe('http://partner.example/deal');
  });
});
