 'use strict';
const LEGACY={300:'xp',500:'capture',1000:'lure'};
function migrateBonuses(config) {
  if ([0,300,500,1000].includes(config.bonusTarget)) config.bonusTarget=config.bonusTarget ? LEGACY[config.bonusTarget]+':1' : '';
  const migrate=list=>{for(const p of Array.isArray(list)?list:[]) if(p && !p.kind && LEGACY[p.cost]) {p.kind=LEGACY[p.cost];p.hours=1;p.source='legacy-inferred';}};
  migrate(config.purchases);
  for(const report of config.accountReports || []) migrate(report?.purchases);
  config.bonusSchemaVersion=1;
  return config;
}
module.exports={migrateBonuses};
