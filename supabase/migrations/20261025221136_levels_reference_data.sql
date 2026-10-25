-- Before We Become Three: the first world's three levels.
--
-- Reference data every environment needs (rooms point at a level), so it ships as a migration
-- rather than seed.sql. Re-running it updates the rows in place. Titles and taglines match the
-- game (src/game/domain/levels/content.ts), where the educational content and its sources live;
-- config holds only what the server checks: the shared puzzles, their rules, and which of them a
-- level needs solved. No health guidance is stored here.
--
-- Puzzle rules:
--   agree     both players submit a value and the two must match (range: whole numbers allowed)
--   together  both players confirm the same joint action

insert into public.levels (
  id, world_number, level_number, title, description, educational_objective, config, unlock_requirements
)
values
  (
    'level01', 1, 1,
    'قرارنا الكبير الأول',
    'نقسّم المسؤوليات سوا قبل ما البيبي ييجي',
    'Communication and sharing responsibilities before parenthood',
    '{
      "puzzles": {
        "l1.clinic_day": {"rule": "agree", "range": [0, 6]},
        "l1.plan_review": {"rule": "together"}
      },
      "required": ["l1.clinic_day", "l1.plan_review"],
      "par_seconds": 420
    }'::jsonb,
    '{"completed": []}'::jsonb
  ),
  (
    'level02', 1, 2,
    'تحدي ميزانية البيبي',
    'نشتري الأساسيات من غير ما نكسر الميزانية',
    'Budgeting, prioritisation and basic arithmetic',
    '{
      "puzzles": {
        "l2.storeroom": {"rule": "together"},
        "l2.cot_carry": {"rule": "together"},
        "l2.checkout_change": {"rule": "agree", "range": [0, 3500]}
      },
      "required": ["l2.storeroom", "l2.cot_carry", "l2.checkout_change"],
      "budget_egp": 3500,
      "reserve_ratio": 0.1,
      "par_seconds": 480
    }'::jsonb,
    '{"completed": ["level01"]}'::jsonb
  ),
  (
    'level03', 1, 3,
    'تجهيز أوضة البيبي',
    'نرتّب الأوضة سوا ونجهّز نوم آمن',
    'Space planning, cooperation and basic infant safe-sleep awareness',
    '{
      "puzzles": {
        "l3.cot_carry": {"rule": "together"},
        "l3.wardrobe_carry": {"rule": "together"},
        "l3.inspection": {"rule": "together"}
      },
      "required": ["l3.cot_carry", "l3.wardrobe_carry", "l3.inspection"],
      "par_seconds": 480
    }'::jsonb,
    '{"completed": ["level02"]}'::jsonb
  )
on conflict (id) do update set
  world_number = excluded.world_number,
  level_number = excluded.level_number,
  title = excluded.title,
  description = excluded.description,
  educational_objective = excluded.educational_objective,
  config = excluded.config,
  unlock_requirements = excluded.unlock_requirements;
