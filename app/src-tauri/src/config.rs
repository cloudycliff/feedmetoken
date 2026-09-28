use serde::Deserialize;
use std::sync::OnceLock;

#[derive(Deserialize)]
struct EmbeddedConfig {
    rules: Rules,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Rules {
    pub tokens_per_bar: u64,
    pub starting_level: u64,
    pub starting_attack_power: u64,
    pub starting_wave: u64,
    pub enemy_base_hp: u64,
    pub enemy_hp_every_waves: u64,
    pub coins_per_defeat: u64,
    pub xp_per_defeat: u64,
    pub xp_per_level: u64,
    pub upgrade_cost_per_attack_power: u64,
    pub attack_power_per_upgrade: u64,
}

static RULES: OnceLock<Rules> = OnceLock::new();

pub(crate) fn rules() -> &'static Rules {
    RULES.get_or_init(|| {
        let config: EmbeddedConfig = serde_json::from_str(include_str!("../../game-config.json"))
            .expect("app/game-config.json 的 rules 配置无法解析");
        let rules = config.rules;
        assert!(rules.tokens_per_bar > 0, "tokensPerBar 必须大于 0");
        assert!(rules.starting_level > 0, "startingLevel 必须大于 0");
        assert!(
            rules.starting_attack_power > 0,
            "startingAttackPower 必须大于 0"
        );
        assert!(rules.starting_wave > 0, "startingWave 必须大于 0");
        assert!(rules.enemy_base_hp > 0, "enemyBaseHp 必须大于 0");
        assert!(
            rules.enemy_hp_every_waves > 0,
            "enemyHpEveryWaves 必须大于 0"
        );
        assert!(rules.xp_per_level > 0, "xpPerLevel 必须大于 0");
        assert!(
            rules.upgrade_cost_per_attack_power > 0,
            "upgradeCostPerAttackPower 必须大于 0"
        );
        assert!(
            rules.attack_power_per_upgrade > 0,
            "attackPowerPerUpgrade 必须大于 0"
        );
        rules
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_rules_load() {
        assert!(rules().tokens_per_bar > 0);
    }
}
