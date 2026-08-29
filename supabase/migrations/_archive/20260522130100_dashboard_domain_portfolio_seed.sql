-- Seed the European TLD catalog for /ceo/domain-portfolio.
-- One row per (country, TLD) pair. Idempotent: re-running is a no-op
-- thanks to the unique (country_code, tld) index.
--
-- Rank 1 is the strongest recommendation; ranks 4-5 are alternatives /
-- hacks / niche options. The status, domain_name, registrar, notes,
-- and timestamp columns stay at defaults — those are CEO-edited.

INSERT INTO public.dashboard_domain_portfolio
  (country_code, country_name, country_flag, region, tld, rank, tld_type, registry, rationale, market_share, restrictions, is_global_hack)
VALUES
  -- NORTH
  ('SE','Sweden','🇸🇪','north','.se',1,'native_cctld','IIS','Default for Swedish-facing businesses; high local trust signal','~58%',NULL,false),
  ('SE','Sweden','🇸🇪','north','.com',2,'generic',NULL,'Global brand fallback, very common in Sweden',NULL,NULL,false),
  ('SE','Sweden','🇸🇪','north','.nu',3,'domain_hack','IIS','"nu" means "now" in Swedish; same registry as .se, popular for hacks',NULL,NULL,true),
  ('SE','Sweden','🇸🇪','north','.eu',4,'generic','EURid','Swedish exporters / EU-facing businesses',NULL,NULL,false),
  ('SE','Sweden','🇸🇪','north','.io',5,'generic',NULL,'Strong adoption in Stockholm tech / startup scene',NULL,NULL,false),

  ('NO','Norway','🇳🇴','north','.no',1,'native_cctld','Norid','Strong trust signal but heavily restricted',NULL,'Norwegian entity / local presence required',false),
  ('NO','Norway','🇳🇴','north','.com',2,'generic',NULL,'Heavily used due to .no restrictions',NULL,NULL,false),
  ('NO','Norway','🇳🇴','north','.co.no',3,'subdomain_convention',NULL,'Widely recognized alternative when .no is unavailable',NULL,NULL,false),
  ('NO','Norway','🇳🇴','north','.io',4,'generic',NULL,'Norwegian tech ecosystem (Oda, Kahoot)',NULL,NULL,false),
  ('NO','Norway','🇳🇴','north','.eu',5,'generic','EURid','Norway is non-EU but adopts .eu (+10.9% growth)',NULL,NULL,false),

  ('DK','Denmark','🇩🇰','north','.dk',1,'native_cctld','DK Hostmaster','Near-universal locally; 97% household internet penetration','dominant',NULL,false),
  ('DK','Denmark','🇩🇰','north','.com',2,'generic',NULL,'International scope',NULL,NULL,false),
  ('DK','Denmark','🇩🇰','north','.eu',3,'generic','EURid','Danish EU-facing exporters',NULL,NULL,false),
  ('DK','Denmark','🇩🇰','north','.net',4,'generic',NULL,'Legacy / tech',NULL,NULL,false),
  ('DK','Denmark','🇩🇰','north','.io',5,'generic',NULL,'Tech / AI startups',NULL,NULL,false),

  ('FI','Finland','🇫🇮','north','.fi',1,'native_cctld','Traficom','Hallmark of authenticity; ~500K+ registered',NULL,NULL,false),
  ('FI','Finland','🇫🇮','north','.com',2,'generic',NULL,'International branding',NULL,NULL,false),
  ('FI','Finland','🇫🇮','north','.eu',3,'generic','EURid','Finnish exporters',NULL,NULL,false),
  ('FI','Finland','🇫🇮','north','.net',4,'generic',NULL,'Legacy',NULL,NULL,false),
  ('FI','Finland','🇫🇮','north','.io',5,'generic',NULL,'Helsinki tech/gaming (Supercell, Wolt)',NULL,NULL,false),

  ('IS','Iceland','🇮🇸','north','.is',1,'native_cctld','ISNIC','Loved locally AND globally for "this.is/..." domain hacks; open to anyone',NULL,NULL,true),
  ('IS','Iceland','🇮🇸','north','.com',2,'generic',NULL,'Standard alternative',NULL,NULL,false),
  ('IS','Iceland','🇮🇸','north','.io',3,'generic',NULL,'Tech scene',NULL,NULL,false),
  ('IS','Iceland','🇮🇸','north','.net',4,'generic',NULL,'Legacy',NULL,NULL,false),
  ('IS','Iceland','🇮🇸','north','.eu',5,'generic','EURid','Iceland is EFTA not EU but used by EU-facing biz',NULL,NULL,false),

  ('EE','Estonia','🇪🇪','north','.ee',1,'native_cctld','EIF','Strong local trust; highest per-capita Baltic adoption','~50%',NULL,false),
  ('EE','Estonia','🇪🇪','north','.com',2,'generic',NULL,'International (e-Residency companies often use .com)',NULL,NULL,false),
  ('EE','Estonia','🇪🇪','north','.eu',3,'generic','EURid','Estonia +6.4% .eu growth',NULL,NULL,false),
  ('EE','Estonia','🇪🇪','north','.io',4,'generic',NULL,'Tallinn SaaS/fintech (Bolt, Wise, Pipedrive)',NULL,NULL,false),
  ('EE','Estonia','🇪🇪','north','.net',5,'generic',NULL,'Legacy',NULL,NULL,false),

  ('LV','Latvia','🇱🇻','north','.lv',1,'native_cctld','NIC.LV','Local default','~52%',NULL,false),
  ('LV','Latvia','🇱🇻','north','.com',2,'generic',NULL,'International',NULL,NULL,false),
  ('LV','Latvia','🇱🇻','north','.eu',3,'generic','EURid','Regional',NULL,NULL,false),
  ('LV','Latvia','🇱🇻','north','.net',4,'generic',NULL,'Legacy',NULL,NULL,false),
  ('LV','Latvia','🇱🇻','north','.io',5,'generic',NULL,'Tech',NULL,NULL,false),

  ('LT','Lithuania','🇱🇹','north','.lt',1,'native_cctld','DOMREG','Strongest Baltic ccTLD share','~60%',NULL,false),
  ('LT','Lithuania','🇱🇹','north','.com',2,'generic',NULL,'International',NULL,NULL,false),
  ('LT','Lithuania','🇱🇹','north','.eu',3,'generic','EURid','Regional',NULL,NULL,false),
  ('LT','Lithuania','🇱🇹','north','.net',4,'generic',NULL,'Legacy',NULL,NULL,false),
  ('LT','Lithuania','🇱🇹','north','.io',5,'generic',NULL,'Vilnius tech (Vinted, NordVPN)',NULL,NULL,false),

  -- WEST
  ('GB','United Kingdom','🇬🇧','west','.co.uk',1,'native_cctld','Nominet','81% market share; default for UK business','81%',NULL,false),
  ('GB','United Kingdom','🇬🇧','west','.com',2,'generic',NULL,'Strong second, global brand',NULL,NULL,false),
  ('GB','United Kingdom','🇬🇧','west','.uk',3,'native_cctld','Nominet','11% share; shorter alternative launched 2014','11%',NULL,false),
  ('GB','United Kingdom','🇬🇧','west','.org.uk',4,'subdomain_convention','Nominet','5% share; charities, communities, non-profits','5%',NULL,false),
  ('GB','United Kingdom','🇬🇧','west','.io',5,'generic',NULL,'London tech / fintech / AI scene',NULL,NULL,false),

  ('IE','Ireland','🇮🇪','west','.ie',1,'native_cctld','IEDR','55.75% share and growing; .com declining','~55%',NULL,false),
  ('IE','Ireland','🇮🇪','west','.com',2,'generic',NULL,'Major second',NULL,NULL,false),
  ('IE','Ireland','🇮🇪','west','.eu',3,'generic','EURid','EU-facing exporters',NULL,NULL,false),
  ('IE','Ireland','🇮🇪','west','.io',4,'generic',NULL,'Dublin tech (Stripe, Intercom)',NULL,NULL,false),
  ('IE','Ireland','🇮🇪','west','.org',5,'generic',NULL,'Non-profits',NULL,NULL,false),

  ('FR','France','🇫🇷','west','.fr',1,'native_cctld','AFNIC','90% of French citizens trust .fr more than .com','~40%',NULL,false),
  ('FR','France','🇫🇷','west','.com',2,'generic',NULL,'Still grew +2.4% in 2025 in the French market',NULL,NULL,false),
  ('FR','France','🇫🇷','west','.eu',3,'generic','EURid','France is a top-3 .eu country',NULL,NULL,false),
  ('FR','France','🇫🇷','west','.net',4,'generic',NULL,'Legacy / tech',NULL,NULL,false),
  ('FR','France','🇫🇷','west','.io',5,'generic',NULL,'Paris / Station-F tech scene (Mistral, Hugging Face)',NULL,NULL,false),

  ('DE','Germany','🇩🇪','west','.de',1,'native_cctld','DENIC','World''s biggest ccTLD: 17.7M registered, 23% of European market','dominant',NULL,false),
  ('DE','Germany','🇩🇪','west','.com',2,'generic',NULL,'Global brand fallback',NULL,NULL,false),
  ('DE','Germany','🇩🇪','west','.eu',3,'generic','EURid','Germany has the most .eu registrations of any country (~1M)',NULL,NULL,false),
  ('DE','Germany','🇩🇪','west','.net',4,'generic',NULL,'Legacy / tech still meaningful in Germany',NULL,NULL,false),
  ('DE','Germany','🇩🇪','west','.io',5,'generic',NULL,'Berlin tech scene',NULL,NULL,false),

  ('NL','Netherlands','🇳🇱','west','.nl',1,'native_cctld','SIDN','World''s 5th biggest ccTLD; 75% of users prefer it','~61%',NULL,false),
  ('NL','Netherlands','🇳🇱','west','.com',2,'generic',NULL,'.nl + .com = 84% of all Dutch registrations',NULL,NULL,false),
  ('NL','Netherlands','🇳🇱','west','.eu',3,'generic','EURid','NL is a top-3 .eu country',NULL,NULL,false),
  ('NL','Netherlands','🇳🇱','west','.io',4,'generic',NULL,'Amsterdam tech / SaaS scene',NULL,NULL,false),
  ('NL','Netherlands','🇳🇱','west','.nu',5,'domain_hack','IIS','Perceived as a "now" hack; some Dutch usage',NULL,NULL,true),

  ('BE','Belgium','🇧🇪','west','.be',1,'native_cctld','DNS Belgium','Globally famous due to YouTube''s youtu.be short links; ~1.75M registered',NULL,NULL,true),
  ('BE','Belgium','🇧🇪','west','.com',2,'generic',NULL,'Neutral choice in a multilingual country (FR/NL/DE)',NULL,NULL,false),
  ('BE','Belgium','🇧🇪','west','.eu',3,'generic','EURid','Brussels = EU capital; lots of EU institutions',NULL,NULL,false),
  ('BE','Belgium','🇧🇪','west','.io',4,'generic',NULL,'Tech',NULL,NULL,false),
  ('BE','Belgium','🇧🇪','west','.net',5,'generic',NULL,'Legacy',NULL,NULL,false),

  ('LU','Luxembourg','🇱🇺','west','.lu',1,'native_cctld','RESTENA','Strong local business presence (~117K, 76% companies)',NULL,NULL,false),
  ('LU','Luxembourg','🇱🇺','west','.com',2,'generic',NULL,'International, common given financial sector',NULL,NULL,false),
  ('LU','Luxembourg','🇱🇺','west','.eu',3,'generic','EURid','EU institutions, financial sector',NULL,NULL,false),
  ('LU','Luxembourg','🇱🇺','west','.io',4,'generic',NULL,'Fintech scene',NULL,NULL,false),
  ('LU','Luxembourg','🇱🇺','west','.net',5,'generic',NULL,'Legacy',NULL,NULL,false),

  ('AT','Austria','🇦🇹','west','.at',1,'native_cctld','nic.at','Local default; 1.5M+ registered, ~70% Austrian-owned',NULL,NULL,false),
  ('AT','Austria','🇦🇹','west','.com',2,'generic',NULL,'Strong second',NULL,NULL,false),
  ('AT','Austria','🇦🇹','west','.eu',3,'generic','EURid','Common',NULL,NULL,false),
  ('AT','Austria','🇦🇹','west','.io',4,'generic',NULL,'Vienna tech',NULL,NULL,false),
  ('AT','Austria','🇦🇹','west','.de',5,'native_cctld','DENIC','Some Austrian businesses also register .de given language overlap',NULL,NULL,false),

  ('CH','Switzerland','🇨🇭','west','.ch',1,'native_cctld','SWITCH','55%+ share; SWITCH/OFCOM operated','55%+',NULL,false),
  ('CH','Switzerland','🇨🇭','west','.com',2,'generic',NULL,'~20%+ of Swiss-held domains','~20%',NULL,false),
  ('CH','Switzerland','🇨🇭','west','.io',3,'generic',NULL,'Zurich tech (ETH spinoffs, crypto valley)',NULL,NULL,false),
  ('CH','Switzerland','🇨🇭','west','.swiss',4,'sponsored','Swiss Confederation','Official Swiss brand TLD for Swiss companies and brands',NULL,'Swiss entity verification required',false),
  ('CH','Switzerland','🇨🇭','west','.eu',5,'generic','EURid','Switzerland is non-EU; less natural fit',NULL,NULL,false),

  ('LI','Liechtenstein','🇱🇮','west','.li',1,'native_cctld','SWITCH','Local default; shares registry with Switzerland',NULL,NULL,false),
  ('LI','Liechtenstein','🇱🇮','west','.ch',2,'native_cctld','SWITCH','Cross-border with Switzerland is common',NULL,NULL,false),
  ('LI','Liechtenstein','🇱🇮','west','.com',3,'generic',NULL,'International',NULL,NULL,false),
  ('LI','Liechtenstein','🇱🇮','west','.eu',4,'generic','EURid','EU exporters (LI is in EEA)',NULL,NULL,false),
  ('LI','Liechtenstein','🇱🇮','west','.io',5,'generic',NULL,'Tech / financial',NULL,NULL,false),

  -- SOUTH
  ('ES','Spain','🇪🇸','south','.es',1,'native_cctld','Red.es','Local default; 2M+ registered, top-40 globally',NULL,NULL,false),
  ('ES','Spain','🇪🇸','south','.com',2,'generic',NULL,'Major second; .com.es subdomain also common',NULL,NULL,false),
  ('ES','Spain','🇪🇸','south','.eu',3,'generic','EURid','Spanish exporters',NULL,NULL,false),
  ('ES','Spain','🇪🇸','south','.io',4,'generic',NULL,'Barcelona + Madrid tech (Glovo, Cabify, Tier)',NULL,NULL,false),
  ('ES','Spain','🇪🇸','south','.cat',5,'sponsored','Fundació puntCAT','Sponsored TLD for Catalan-speaking businesses (~110K registered)',NULL,'Catalan language / cultural use',false),

  ('PT','Portugal','🇵🇹','south','.pt',1,'native_cctld','DNS.PT','Local default for Portugal-specific business','~10% of PT-lang internet',NULL,false),
  ('PT','Portugal','🇵🇹','south','.com',2,'generic',NULL,'Heavy usage (Portuguese-lang internet dominated by .br/.com)',NULL,NULL,false),
  ('PT','Portugal','🇵🇹','south','.eu',3,'generic','EURid','Portuguese exporters',NULL,NULL,false),
  ('PT','Portugal','🇵🇹','south','.io',4,'generic',NULL,'Lisbon tech (Web Summit hub)',NULL,NULL,false),
  ('PT','Portugal','🇵🇹','south','.net',5,'generic',NULL,'Legacy',NULL,NULL,false),

  ('IT','Italy','🇮🇹','south','.it',1,'native_cctld','Registro.it','Top-10 ccTLD globally; 3.1M+ registered',NULL,NULL,false),
  ('IT','Italy','🇮🇹','south','.com',2,'generic',NULL,'International',NULL,NULL,false),
  ('IT','Italy','🇮🇹','south','.eu',3,'generic','EURid','Common',NULL,NULL,false),
  ('IT','Italy','🇮🇹','south','.io',4,'generic',NULL,'Milan / Rome tech (Bending Spoons)',NULL,NULL,false),
  ('IT','Italy','🇮🇹','south','.net',5,'generic',NULL,'Legacy',NULL,NULL,false),

  ('GR','Greece','🇬🇷','south','.gr',1,'native_cctld','FORTH-ICS','Strongly localized; 96% of Greeks search Google.gr',NULL,NULL,false),
  ('GR','Greece','🇬🇷','south','.com',2,'generic',NULL,'Second',NULL,NULL,false),
  ('GR','Greece','🇬🇷','south','.eu',3,'generic','EURid','EU exporters (+5.1% growth)',NULL,NULL,false),
  ('GR','Greece','🇬🇷','south','.com.gr',4,'subdomain_convention','FORTH-ICS','Businesses (subdomain convention common)',NULL,NULL,false),
  ('GR','Greece','🇬🇷','south','.io',5,'generic',NULL,'Athens tech scene',NULL,NULL,false),

  ('MT','Malta','🇲🇹','south','.com.mt',1,'subdomain_convention','NIC-MT','Historically dominant (commercial entities)',NULL,'Maltese entity or local presence',false),
  ('MT','Malta','🇲🇹','south','.mt',2,'native_cctld','NIC-MT','Direct second-level since December 2017',NULL,'Same restrictions as .com.mt',false),
  ('MT','Malta','🇲🇹','south','.com',3,'generic',NULL,'Major (EU-facing iGaming / finance)',NULL,NULL,false),
  ('MT','Malta','🇲🇹','south','.eu',4,'generic','EURid','Common given EU / Malta financial services',NULL,NULL,false),
  ('MT','Malta','🇲🇹','south','.io',5,'generic',NULL,'Fintech, crypto, iGaming firms',NULL,NULL,false),

  ('CY','Cyprus','🇨🇾','south','.com.cy',1,'subdomain_convention','University of Cyprus','Most common (commercial entities)',NULL,NULL,false),
  ('CY','Cyprus','🇨🇾','south','.cy',2,'native_cctld','University of Cyprus','Direct level usable since 2024 by registered owners',NULL,'Restricted to existing .com.cy owners',false),
  ('CY','Cyprus','🇨🇾','south','.com',3,'generic',NULL,'Major',NULL,NULL,false),
  ('CY','Cyprus','🇨🇾','south','.eu',4,'generic','EURid','Common',NULL,NULL,false),
  ('CY','Cyprus','🇨🇾','south','.io',5,'generic',NULL,'Fintech / forex (CySEC hub)',NULL,NULL,false),

  ('SI','Slovenia','🇸🇮','south','.si',1,'native_cctld','ARNES','Local default; high DNSSEC adoption; "si" = "you are" in Slovene',NULL,NULL,false),
  ('SI','Slovenia','🇸🇮','south','.com',2,'generic',NULL,'International',NULL,NULL,false),
  ('SI','Slovenia','🇸🇮','south','.eu',3,'generic','EURid','Common',NULL,NULL,false),
  ('SI','Slovenia','🇸🇮','south','.io',4,'generic',NULL,'Tech scene',NULL,NULL,false),
  ('SI','Slovenia','🇸🇮','south','.net',5,'generic',NULL,'Legacy',NULL,NULL,false),

  ('HR','Croatia','🇭🇷','south','.hr',1,'native_cctld','CARNET','Local default; historically expensive (one .hr per legal entity)',NULL,'Pricier than most EU ccTLDs',false),
  ('HR','Croatia','🇭🇷','south','.com.hr',2,'subdomain_convention','CARNET','Commercial subdomain alternative',NULL,NULL,false),
  ('HR','Croatia','🇭🇷','south','.com',3,'generic',NULL,'Major; often preferred due to .hr cost',NULL,NULL,false),
  ('HR','Croatia','🇭🇷','south','.eu',4,'generic','EURid','Exporters',NULL,NULL,false),
  ('HR','Croatia','🇭🇷','south','.io',5,'generic',NULL,'Zagreb tech (Rimac, Infobip)',NULL,NULL,false),

  -- EAST
  ('PL','Poland','🇵🇱','east','.pl',1,'native_cctld','NASK','Clear local default; 2.6M+ active, 90% locally registered',NULL,NULL,false),
  ('PL','Poland','🇵🇱','east','.com',2,'generic',NULL,'International',NULL,NULL,false),
  ('PL','Poland','🇵🇱','east','.com.pl',3,'subdomain_convention','NASK','Businesses (subdomain convention)',NULL,NULL,false),
  ('PL','Poland','🇵🇱','east','.eu',4,'generic','EURid','Exporters',NULL,NULL,false),
  ('PL','Poland','🇵🇱','east','.io',5,'generic',NULL,'Warsaw / Kraków tech scene',NULL,NULL,false),

  ('CZ','Czechia','🇨🇿','east','.cz',1,'native_cctld','CZ.NIC','Strong local default; 1.4M+ registered',NULL,NULL,false),
  ('CZ','Czechia','🇨🇿','east','.com',2,'generic',NULL,'International',NULL,NULL,false),
  ('CZ','Czechia','🇨🇿','east','.eu',3,'generic','EURid','Common',NULL,NULL,false),
  ('CZ','Czechia','🇨🇿','east','.io',4,'generic',NULL,'Prague tech (Avast, JetBrains)',NULL,NULL,false),
  ('CZ','Czechia','🇨🇿','east','.net',5,'generic',NULL,'Legacy',NULL,NULL,false),

  ('SK','Slovakia','🇸🇰','east','.sk',1,'native_cctld','SK-NIC','Local default; ~500K+ registered',NULL,NULL,false),
  ('SK','Slovakia','🇸🇰','east','.com',2,'generic',NULL,'International',NULL,NULL,false),
  ('SK','Slovakia','🇸🇰','east','.eu',3,'generic','EURid','Common',NULL,NULL,false),
  ('SK','Slovakia','🇸🇰','east','.cz',4,'native_cctld','CZ.NIC','Some Slovaks register .cz for combined CZ/SK audiences',NULL,NULL,false),
  ('SK','Slovakia','🇸🇰','east','.io',5,'generic',NULL,'Bratislava tech scene',NULL,NULL,false),

  ('HU','Hungary','🇭🇺','east','.hu',1,'native_cctld','ISZT','Local default; open since 2025 to anyone with justified use',NULL,NULL,false),
  ('HU','Hungary','🇭🇺','east','.com',2,'generic',NULL,'International',NULL,NULL,false),
  ('HU','Hungary','🇭🇺','east','.eu',3,'generic','EURid','Common',NULL,NULL,false),
  ('HU','Hungary','🇭🇺','east','.io',4,'generic',NULL,'Budapest tech (Prezi, LogMeIn)',NULL,NULL,false),
  ('HU','Hungary','🇭🇺','east','.net',5,'generic',NULL,'Legacy',NULL,NULL,false),

  ('RO','Romania','🇷🇴','east','.ro',1,'native_cctld','ROTLD','Local default; ~1M+ registered',NULL,NULL,false),
  ('RO','Romania','🇷🇴','east','.com',2,'generic',NULL,'International',NULL,NULL,false),
  ('RO','Romania','🇷🇴','east','.eu',3,'generic','EURid','Romania top-3 .eu growth country (+22%)',NULL,NULL,false),
  ('RO','Romania','🇷🇴','east','.io',4,'generic',NULL,'Bucharest / Cluj tech (UiPath origin)',NULL,NULL,false),
  ('RO','Romania','🇷🇴','east','.net',5,'generic',NULL,'Legacy',NULL,NULL,false),

  ('BG','Bulgaria','🇧🇬','east','.com',1,'generic',NULL,'Bulgarian companies often prefer .com over .bg',NULL,NULL,false),
  ('BG','Bulgaria','🇧🇬','east','.bg',2,'native_cctld','Register.BG','Local ccTLD; pricier (~€30/yr)',NULL,NULL,false),
  ('BG','Bulgaria','🇧🇬','east','.eu',3,'generic','EURid','Bulgaria has the world''s #1 .eu growth (+43%)',NULL,NULL,false),
  ('BG','Bulgaria','🇧🇬','east','.io',4,'generic',NULL,'Sofia tech (Telerik, VMware)',NULL,NULL,false),
  ('BG','Bulgaria','🇧🇬','east','.net',5,'generic',NULL,'Legacy',NULL,NULL,false),

  ('RS','Serbia','🇷🇸','east','.rs',1,'native_cctld','RNIDS','Local default; ~110K registered',NULL,NULL,false),
  ('RS','Serbia','🇷🇸','east','.com',2,'generic',NULL,'Major; .com gets significant share locally',NULL,NULL,false),
  ('RS','Serbia','🇷🇸','east','.co.rs',3,'subdomain_convention','RNIDS','Subdomain convention for commercial',NULL,NULL,false),
  ('RS','Serbia','🇷🇸','east','.eu',4,'generic','EURid','Serbia is EU candidate',NULL,NULL,false),
  ('RS','Serbia','🇷🇸','east','.io',5,'generic',NULL,'Belgrade / Novi Sad tech',NULL,NULL,false),

  ('ME','Montenegro','🇲🇪','east','.me',1,'native_cctld','doMEn','Most globally-famous European ccTLD: 2.4M+ registered worldwide (about.me, wp.me, ti.me, fav.me)',NULL,NULL,true),
  ('ME','Montenegro','🇲🇪','east','.com',2,'generic',NULL,'Common locally',NULL,NULL,false),
  ('ME','Montenegro','🇲🇪','east','.eu',3,'generic','EURid','Exporters',NULL,NULL,false),
  ('ME','Montenegro','🇲🇪','east','.io',4,'generic',NULL,'Tech',NULL,NULL,false),
  ('ME','Montenegro','🇲🇪','east','.net',5,'generic',NULL,'Legacy',NULL,NULL,false),

  ('AL','Albania','🇦🇱','east','.al',1,'native_cctld','AKEP','Local default; open registration',NULL,NULL,false),
  ('AL','Albania','🇦🇱','east','.com',2,'generic',NULL,'International, very common',NULL,NULL,false),
  ('AL','Albania','🇦🇱','east','.com.al',3,'subdomain_convention','AKEP','Businesses',NULL,NULL,false),
  ('AL','Albania','🇦🇱','east','.eu',4,'generic','EURid','Albania is EU candidate',NULL,NULL,false),
  ('AL','Albania','🇦🇱','east','.org',5,'generic',NULL,'Non-profits',NULL,NULL,false),

  ('MK','North Macedonia','🇲🇰','east','.mk',1,'native_cctld','MARnet','Local default',NULL,NULL,false),
  ('MK','North Macedonia','🇲🇰','east','.com.mk',2,'subdomain_convention','MARnet','Businesses (commonly used)',NULL,NULL,false),
  ('MK','North Macedonia','🇲🇰','east','.com',3,'generic',NULL,'International',NULL,NULL,false),
  ('MK','North Macedonia','🇲🇰','east','.eu',4,'generic','EURid','Exporters',NULL,NULL,false),
  ('MK','North Macedonia','🇲🇰','east','.org.mk',5,'subdomain_convention','MARnet','Non-profits',NULL,NULL,false),

  ('BA','Bosnia and Herzegovina','🇧🇦','east','.ba',1,'native_cctld','UTIC','Local default but restricted to BiH residents/entities',NULL,'BiH entity required',false),
  ('BA','Bosnia and Herzegovina','🇧🇦','east','.com',2,'generic',NULL,'Heavy usage given .ba restrictions',NULL,NULL,false),
  ('BA','Bosnia and Herzegovina','🇧🇦','east','.com.ba',3,'subdomain_convention','UTIC','Restricted business subdomain',NULL,'BiH entity required',false),
  ('BA','Bosnia and Herzegovina','🇧🇦','east','.eu',4,'generic','EURid','Exporters',NULL,NULL,false),
  ('BA','Bosnia and Herzegovina','🇧🇦','east','.io',5,'generic',NULL,'Small tech scene',NULL,NULL,false),

  ('XK','Kosovo','🇽🇰','east','.com',1,'generic',NULL,'Default — Kosovo has no assigned ccTLD (.xk reserved but not delegated)',NULL,NULL,false),
  ('XK','Kosovo','🇽🇰','east','.eu',2,'generic','EURid','Exporters',NULL,NULL,false),
  ('XK','Kosovo','🇽🇰','east','.net',3,'generic',NULL,'Legacy',NULL,NULL,false),
  ('XK','Kosovo','🇽🇰','east','.org',4,'generic',NULL,'Non-profits',NULL,NULL,false),
  ('XK','Kosovo','🇽🇰','east','.io',5,'generic',NULL,'Pristina tech scene (growing)',NULL,NULL,false),

  ('UA','Ukraine','🇺🇦','east','.ua',1,'native_cctld','Hostmaster.ua','Direct second-level, widely used; ~600K+ registered',NULL,NULL,false),
  ('UA','Ukraine','🇺🇦','east','.com.ua',2,'subdomain_convention','Hostmaster.ua','Historically the most common (commercial subdomain)',NULL,NULL,false),
  ('UA','Ukraine','🇺🇦','east','.com',3,'generic',NULL,'International',NULL,NULL,false),
  ('UA','Ukraine','🇺🇦','east','.eu',4,'generic','EURid','EU candidate, strongly EU-facing since 2022',NULL,NULL,false),
  ('UA','Ukraine','🇺🇦','east','.io',5,'generic',NULL,'Kyiv / Lviv tech (Grammarly, GitLab, MacPaw)',NULL,NULL,false),

  ('MD','Moldova','🇲🇩','east','.md',1,'native_cctld','MoldData','Used both locally AND globally as a "Doctor of Medicine" hack',NULL,'Expensive (~$60+/yr); open registration',true),
  ('MD','Moldova','🇲🇩','east','.com',2,'generic',NULL,'Local default for budget reasons',NULL,NULL,false),
  ('MD','Moldova','🇲🇩','east','.eu',3,'generic','EURid','Moldova is EU candidate',NULL,NULL,false),
  ('MD','Moldova','🇲🇩','east','.net',4,'generic',NULL,'Legacy',NULL,NULL,false),
  ('MD','Moldova','🇲🇩','east','.org',5,'generic',NULL,'Non-profits',NULL,NULL,false),

  ('BY','Belarus','🇧🇾','east','.by',1,'native_cctld','hoster.by','Local default; open registration',NULL,NULL,false),
  ('BY','Belarus','🇧🇾','east','.com',2,'generic',NULL,'International (used heavily post-2020 by Belarusian diaspora/tech)',NULL,NULL,false),
  ('BY','Belarus','🇧🇾','east','.eu',3,'generic','EURid','Exporters',NULL,NULL,false),
  ('BY','Belarus','🇧🇾','east','.io',4,'generic',NULL,'Belarusian tech diaspora (EPAM, Wargaming, Viber)',NULL,NULL,false),
  ('BY','Belarus','🇧🇾','east','.org',5,'generic',NULL,'Non-profits',NULL,NULL,false),

  ('RU','Russia','🇷🇺','east','.ru',1,'native_cctld','Coordination Center for TLD RU','World''s 5th biggest ccTLD: 6M+ registered',NULL,NULL,false),
  ('RU','Russia','🇷🇺','east','.рф',2,'idn','Coordination Center for TLD RU','Cyrillic IDN ccTLD (~700K+ registered)',NULL,NULL,false),
  ('RU','Russia','🇷🇺','east','.com',3,'generic',NULL,'International',NULL,NULL,false),
  ('RU','Russia','🇷🇺','east','.net',4,'generic',NULL,'Legacy',NULL,NULL,false),
  ('RU','Russia','🇷🇺','east','.su',5,'generic','Foundation for Internet Development','Soviet-era TLD still in use (~100K); legacy / nostalgia',NULL,NULL,false)
ON CONFLICT (country_code, tld) DO NOTHING;
