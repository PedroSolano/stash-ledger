//! Limitador baseado nos cabeçalhos X-Rate-Limit-* da GGG. Os limites são dinâmicos: o app aprende a
//! política na primeira resposta e, daí em diante, espera antes de estourar qualquer regra.
//! Docs: https://www.pathofexile.com/developer/docs#ratelimits

use reqwest::header::HeaderMap;
use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

pub fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// "hits:período:timeout,..." → [(hits, período s, timeout s)]
pub fn parse_rules(value: &str) -> Vec<(u64, u64, u64)> {
    value
        .split(',')
        .filter_map(|part| {
            let n: Vec<u64> = part.trim().split(':').filter_map(|x| x.trim().parse().ok()).collect();
            (n.len() == 3).then(|| (n[0], n[1], n[2]))
        })
        .collect()
}

#[derive(Default)]
struct Policy {
    rules: Vec<(u64, u64)>, // (hits, período em ms)
    log: Vec<u64>,
    blocked_until: u64,
}

#[derive(Default)]
pub struct Limiter {
    policies: HashMap<String, Policy>,
    endpoint_policy: HashMap<String, String>,
}

fn header<'a>(h: &'a HeaderMap, name: &str) -> Option<&'a str> {
    h.get(name).and_then(|v| v.to_str().ok())
}

impl Limiter {
    /// Quanto esperar (ms) antes da próxima requisição nesse endpoint.
    pub fn delay_for(&self, endpoint: &str, now: u64) -> u64 {
        let Some(policy) = self.endpoint_policy.get(endpoint).and_then(|n| self.policies.get(n)) else {
            return 0;
        };
        let mut wait = policy.blocked_until.saturating_sub(now);
        for &(hits, period) in &policy.rules {
            // Margem de segurança: nunca usa a última vaga da janela.
            let allowed = hits.saturating_sub(1).max(1) as usize;
            let in_window: Vec<u64> = policy.log.iter().copied().filter(|t| now.saturating_sub(*t) < period).collect();
            if in_window.len() >= allowed {
                let oldest = in_window[in_window.len() - allowed];
                wait = wait.max((oldest + period + 250).saturating_sub(now));
            }
        }
        wait
    }

    pub fn record(&mut self, endpoint: &str, now: u64) {
        let Some(name) = self.endpoint_policy.get(endpoint) else { return };
        if let Some(policy) = self.policies.get_mut(name) {
            policy.log.push(now);
            let max = policy.rules.iter().map(|r| r.1).max().unwrap_or(0);
            policy.log.retain(|t| now.saturating_sub(*t) < max);
        }
    }

    pub fn update(&mut self, endpoint: &str, headers: &HeaderMap, status: u16, now: u64) {
        let Some(name) = header(headers, "x-rate-limit-policy").map(str::to_string) else { return };
        let first_seen = !self.policies.contains_key(&name);
        self.endpoint_policy.insert(endpoint.to_string(), name.clone());
        let policy = self.policies.entry(name).or_default();
        let mut rules = Vec::new();
        for rule in header(headers, "x-rate-limit-rules").unwrap_or("").split(',').map(str::trim).filter(|s| !s.is_empty()) {
            let rule = rule.to_ascii_lowercase();
            let limits = parse_rules(header(headers, &format!("x-rate-limit-{rule}")).unwrap_or(""));
            let states = parse_rules(header(headers, &format!("x-rate-limit-{rule}-state")).unwrap_or(""));
            for (i, &(hits, period, _timeout)) in limits.iter().enumerate() {
                rules.push((hits, period * 1000));
                if let Some(&(cur, _p, active)) = states.get(i) {
                    if active > 0 {
                        policy.blocked_until = policy.blocked_until.max(now + active * 1000);
                    } else if cur >= hits {
                        policy.blocked_until = policy.blocked_until.max(now + period * 1000);
                    }
                }
            }
        }
        if !rules.is_empty() {
            policy.rules = rules;
        }
        if first_seen {
            policy.log.push(now); // a requisição que trouxe a política também conta
        }
        if status == 429 {
            if let Some(ra) = header(headers, "retry-after").and_then(|v| v.parse::<u64>().ok()) {
                policy.blocked_until = policy.blocked_until.max(now + ra * 1000);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use reqwest::header::{HeaderName, HeaderValue};

    fn headers(pairs: &[(&str, &str)]) -> HeaderMap {
        let mut h = HeaderMap::new();
        for (k, v) in pairs {
            h.insert(HeaderName::from_bytes(k.as_bytes()).unwrap(), HeaderValue::from_str(v).unwrap());
        }
        h
    }

    #[test]
    fn parses_rules() {
        assert_eq!(parse_rules("30:60:120,90:1800:600"), vec![(30, 60, 120), (90, 1800, 600)]);
        assert!(parse_rules("lixo").is_empty());
    }

    #[test]
    fn waits_before_breaking_learned_rule() {
        let mut l = Limiter::default();
        let now = 1_000_000;
        l.update(
            "stash",
            &headers(&[
                ("x-rate-limit-policy", "backend-item-request-limit"),
                ("x-rate-limit-rules", "Ip"),
                ("x-rate-limit-ip", "3:10:60"),
                ("x-rate-limit-ip-state", "1:10:0"),
            ]),
            200,
            now,
        );
        assert_eq!(l.delay_for("stash", now), 0);
        l.record("stash", now);
        assert!(l.delay_for("stash", now) > 9_000);
        assert_eq!(l.delay_for("stash", now + 10_500), 0);
    }

    #[test]
    fn honours_retry_after_and_active_restriction() {
        let mut l = Limiter::default();
        let now = 5_000_000;
        l.update(
            "x",
            &headers(&[
                ("x-rate-limit-policy", "p"),
                ("x-rate-limit-rules", "Ip"),
                ("x-rate-limit-ip", "10:5:60"),
                ("x-rate-limit-ip-state", "11:5:60"),
                ("retry-after", "60"),
            ]),
            429,
            now,
        );
        assert!(l.delay_for("x", now) >= 60_000);
    }
}
