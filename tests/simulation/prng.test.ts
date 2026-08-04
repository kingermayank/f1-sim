import { createPrng } from '../../src/simulation/prng';

it('repeats the same sequence for the same seed', () => {
  const a = createPrng('race-42');
  const b = createPrng('race-42');

  expect([a.next(), a.next(), a.next()]).toEqual([b.next(), b.next(), b.next()]);
});

it('produces different sequences for different seeds', () => {
  expect(createPrng('a').next()).not.toBe(createPrng('b').next());
});

it('rejects picking from an empty array', () => {
  expect(() => createPrng('race-42').pick([])).toThrow('Cannot pick from an empty array');
});
