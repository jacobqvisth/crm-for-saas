// SE chain/franchise detection. Applied at promote time to tag multi-location brands.
// A location can match multiple chains (rare). All matches append `chain_<slug>` to tags.
export const SE_CHAINS = [
  // Electrical
  { slug: 'elkedjan',    name_patterns: [/\belkedjan\b/i, /del av elkedjan/i],    vertical: 'electrical' },
  { slug: 'bravida',     name_patterns: [/\bbravida\b/i],                          vertical: 'electrical_vvs' },
  { slug: 'assemblin',   name_patterns: [/\bassemblin\b/i],                        vertical: 'electrical_vvs' },
  { slug: 'caverion',    name_patterns: [/\bcaverion\b/i],                         vertical: 'electrical_vvs' },
  { slug: 'instalco',    name_patterns: [/\binstalco\b/i],                         vertical: 'electrical_vvs' },
  { slug: 'eitech',      name_patterns: [/\beitech\b/i],                           vertical: 'electrical' },
  { slug: 'elajo',       name_patterns: [/\belajo\b/i],                            vertical: 'electrical' },
  { slug: 'clas_fixare', name_patterns: [/clas\s+fixare/i, /clas\s+ohlson/i],      vertical: 'multi_trade' },

  // Building materials retail
  { slug: 'byggmax',     name_patterns: [/\bbyggmax\b/i],                          vertical: 'building_materials' },
  { slug: 'bauhaus',     name_patterns: [/\bbauhaus\b/i],                          vertical: 'building_materials' },
  { slug: 'beijer',      name_patterns: [/beijer\s+byggmaterial/i, /\bbeijer\b/i], vertical: 'building_materials' },
  { slug: 'hornbach',    name_patterns: [/\bhornbach\b/i],                         vertical: 'building_materials' },
  { slug: 'ahlsell',     name_patterns: [/\bahlsell\b/i],                          vertical: 'b2b_distribution' },

  // Auto (in scope for discovery set but not contractor ICP)
  { slug: 'mekonomen',   name_patterns: [/\bmekonomen\b/i],                        vertical: 'auto' },
  { slug: 'bosch_car',   name_patterns: [/bosch\s+car\s+service/i],                vertical: 'auto' },
  { slug: 'ad_bildelar', name_patterns: [/\bad\s+bildelar\b/i],                    vertical: 'auto' },
  { slug: 'euromaster',  name_patterns: [/\beuromaster\b/i],                       vertical: 'auto' },
];

/**
 * Match a shop's name against the chain list. Returns array of matching chain slugs (possibly empty).
 */
export function detectChains(name) {
  if (!name) return [];
  const hits = [];
  for (const chain of SE_CHAINS) {
    if (chain.name_patterns.some((rx) => rx.test(name))) {
      hits.push(`chain_${chain.slug}`);
    }
  }
  return hits;
}
