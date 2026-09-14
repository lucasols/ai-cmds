import { describe, expect, it } from 'vitest';
import { pickClosestBaseBranch } from '../src/lib/git.ts';

describe('pickClosestBaseBranch', () => {
  it('returns null when there are no candidates', () => {
    expect(pickClosestBaseBranch([])).toBeNull();
  });

  it('picks the candidate with the smallest distance', () => {
    expect(
      pickClosestBaseBranch([
        { branch: 'develop', distance: 12 },
        { branch: 'release/1.0', distance: 3 },
        { branch: 'main', distance: 40 },
      ]),
    ).toEqual({ branch: 'release/1.0', distance: 3 });
  });

  it('skips candidates that already contain HEAD', () => {
    expect(
      pickClosestBaseBranch([
        { branch: 'feature/child', distance: 0 },
        { branch: 'main', distance: 5 },
      ]),
    ).toEqual({ branch: 'main', distance: 5 });
  });

  it('returns null when every candidate contains HEAD', () => {
    expect(
      pickClosestBaseBranch([
        { branch: 'feature/child', distance: 0 },
        { branch: 'feature/other-child', distance: 0 },
      ]),
    ).toBeNull();
  });

  it('prefers well-known base names on ties', () => {
    expect(
      pickClosestBaseBranch([
        { branch: 'dev', distance: 4 },
        { branch: 'feature/sibling', distance: 4 },
        { branch: 'main', distance: 4 },
        { branch: 'develop', distance: 4 },
      ]),
    ).toEqual({ branch: 'main', distance: 4 });
  });

  it('prefers shorter names on ties between unknown branches', () => {
    expect(
      pickClosestBaseBranch([
        { branch: 'release/1.0.0-rc', distance: 2 },
        { branch: 'release/1.0', distance: 2 },
      ]),
    ).toEqual({ branch: 'release/1.0', distance: 2 });
  });

  it('breaks equal-length ties alphabetically for determinism', () => {
    expect(
      pickClosestBaseBranch([
        { branch: 'rel/b', distance: 2 },
        { branch: 'rel/a', distance: 2 },
      ]),
    ).toEqual({ branch: 'rel/a', distance: 2 });
  });
});
