#!/usr/bin/env python3
import argparse
import math
import os
import re
from collections import defaultdict

import psycopg


def normalize_color(value):
    raw = (value or "").strip().upper()
    mapping = {
        "RED": "RED",
        "ROUGE": "RED",
        "WHITE": "WHITE",
        "BLANC": "WHITE",
        "YELLOW": "YELLOW",
        "JAUNE": "YELLOW",
        "BLUE": "BLUE",
        "BLEU": "BLUE",
        "GREEN": "GREEN",
        "VERT": "GREEN",
        "BLACK": "BLACK",
        "NOIR": "BLACK",
    }
    return mapping.get(raw, raw)


def max_advancers_for_heat_size(heat_size):
    if heat_size <= 0:
        return 0
    if heat_size <= 2:
        return 1
    return 2


def make_placeholder(ref):
    return f"R{ref['source_round']}-H{ref['source_heat']}-P{ref['source_position']}"


def move_snake_cursor(index, direction, heat_count):
    if heat_count <= 1:
        return 0, 1
    if direction == 1:
        if index == heat_count - 1:
            return index, -1
        return index + 1, direction
    if index == 0:
        return index, 1
    return index - 1, direction


def distribute_refs_snake_variable(refs, target_heats):
    assignments = [
        {
            "heat_id": heat["id"],
            "capacity": max(0, int(heat["heat_size"] or 0)),
            "refs": [],
        }
        for heat in target_heats
    ]
    if not assignments or not refs:
        return assignments

    index = 0
    direction = 1
    for ref in refs:
        fallback = None
        chosen = None
        candidate_index = index
        candidate_direction = direction

        for _ in range(len(assignments) * 2):
            assignment = assignments[candidate_index]
            has_capacity = len(assignment["refs"]) < assignment["capacity"]
            if has_capacity:
                if fallback is None:
                    fallback = (candidate_index, candidate_direction)

                has_collision = any(
                    existing["source_heat"] is not None
                    and ref["source_heat"] is not None
                    and existing["source_round"] == ref["source_round"]
                    and existing["source_heat"] == ref["source_heat"]
                    for existing in assignment["refs"]
                )
                if not has_collision:
                    chosen = (candidate_index, candidate_direction)
                    break

            candidate_index, candidate_direction = move_snake_cursor(
                candidate_index,
                candidate_direction,
                len(assignments),
            )

        if chosen is None:
            chosen = fallback
        if chosen is None:
            continue

        chosen_index, chosen_direction = chosen
        assignments[chosen_index]["refs"].append(ref)
        index, direction = move_snake_cursor(chosen_index, chosen_direction, len(assignments))

    return assignments


def build_layered_refs(previous_round_heats, requested_advancers, total_current_slots):
    refs = []
    for position in range(1, requested_advancers + 1):
        for heat in previous_round_heats:
            heat_size = max(0, int(heat["heat_size"] or 0))
            advancers = min(max_advancers_for_heat_size(heat_size), requested_advancers)
            if position > advancers:
                continue

            refs.append(
                {
                    "source_round": int(heat["round"]),
                    "source_heat": int(heat["heat_number"]),
                    "source_position": position,
                }
            )
    if len(refs) < total_current_slots and len(previous_round_heats) > 1:
        refs.append(
            {
                "source_round": int(previous_round_heats[0]["round"]),
                "source_heat": None,
                "source_position": None,
                "best_second_round": int(previous_round_heats[0]["round"]),
            }
        )
    return refs


def infer_mappings(sequence, target_heat_id):
    ordered = sorted(sequence, key=lambda row: (int(row["round"]), int(row["heat_number"])))
    target = next((heat for heat in ordered if heat["id"] == target_heat_id), None)
    if not target or int(target["round"]) <= 1:
        return []

    previous_round = int(target["round"]) - 1
    previous_round_heats = [heat for heat in ordered if int(heat["round"]) == previous_round]
    current_round_heats = [heat for heat in ordered if int(heat["round"]) == int(target["round"])]
    if not previous_round_heats or not current_round_heats:
        return []

    total_current_slots = sum(max(0, int(heat["heat_size"] or 0)) for heat in current_round_heats)
    if total_current_slots <= 0:
        return []

    requested_advancers = max(1, math.ceil(total_current_slots / len(previous_round_heats)))
    refs = build_layered_refs(previous_round_heats, requested_advancers, total_current_slots)

    assignments = distribute_refs_snake_variable(refs, current_round_heats)
    target_assignment = next((assignment for assignment in assignments if assignment["heat_id"] == target_heat_id), None)
    if not target_assignment:
        return []

    return [
        {
            "heat_id": target_heat_id,
            "position": index + 1,
            "placeholder": f"Meilleur 2e R{ref['best_second_round']}" if ref.get("best_second_round") else make_placeholder(ref),
            "source_round": None if ref.get("best_second_round") else ref["source_round"],
            "source_heat": None if ref.get("best_second_round") else ref["source_heat"],
            "source_position": None if ref.get("best_second_round") else ref["source_position"],
        }
        for index, ref in enumerate(target_assignment["refs"])
    ]


def compute_effective_interferences(calls, judge_count):
    if not calls or judge_count <= 0:
        return []

    by_target = defaultdict(list)
    for call in calls:
        key = f"{normalize_color(call['surfer'])}::{int(call['wave_number'])}"
        by_target[key].append(call)

    threshold = math.floor(judge_count / 2) + 1
    effective = []

    for target_calls in by_target.values():
        sorted_calls = sorted(
            target_calls,
            key=lambda call: (
                call.get("updated_at") or call.get("created_at") or "",
                call.get("created_at") or "",
            ),
            reverse=True,
        )

        override = next((call for call in sorted_calls if call.get("is_head_judge_override")), None)
        if override:
            effective.append(
                {
                    "surfer": normalize_color(override["surfer"]),
                    "wave_number": int(override["wave_number"]),
                    "type": override["call_type"],
                }
            )
            continue

        latest_by_judge = {}
        for call in sorted_calls:
            judge_key = (call.get("judge_id") or "").strip().upper()
            if judge_key and judge_key not in latest_by_judge:
                latest_by_judge[judge_key] = call

        int1 = sum(1 for call in latest_by_judge.values() if call.get("call_type") == "INT1")
        int2 = sum(1 for call in latest_by_judge.values() if call.get("call_type") == "INT2")

        if int2 >= threshold:
            reference = next((call for call in sorted_calls if call.get("call_type") == "INT2"), sorted_calls[0])
            effective.append(
                {
                    "surfer": normalize_color(reference["surfer"]),
                    "wave_number": int(reference["wave_number"]),
                    "type": "INT2",
                }
            )
        elif int1 >= threshold:
            reference = next((call for call in sorted_calls if call.get("call_type") == "INT1"), sorted_calls[0])
            effective.append(
                {
                    "surfer": normalize_color(reference["surfer"]),
                    "wave_number": int(reference["wave_number"]),
                    "type": "INT1",
                }
            )

    return sorted(effective, key=lambda item: (item["surfer"], item["wave_number"]))


def summarize_interference_by_surfer(effective):
    summary = {}
    for item in effective:
        key = normalize_color(item["surfer"])
        current = summary.get(key, {"count": 0, "type": None, "is_disqualified": False})
        next_count = current["count"] + 1
        summary[key] = {
            "count": next_count,
            "type": current["type"] or item["type"],
            "is_disqualified": next_count >= 2,
        }
    return summary


def calculate_score_average(scores, judge_count):
    if not scores:
        return 0.0
    values = list(scores)
    if judge_count >= 5 and len(values) >= judge_count:
        values.sort()
        trimmed = values[1:-1]
        if trimmed:
            return round(sum(trimmed) / len(trimmed), 2)
    return round(sum(values) / len(values), 2)


def rank_surfer_stats(scores, entries, interference_calls):
    entry_by_color = {}
    for entry in entries:
      color = normalize_color(entry["color"])
      if not color:
          continue
      entry_by_color[color] = {
          "participant_id": entry["participant_id"],
          "seed": entry["seed"],
          "color": entry["color"],
      }

    if not entry_by_color:
        return {}

    grouped = defaultdict(lambda: defaultdict(dict))
    judge_keys = set()
    for score in scores:
        if float(score["score"] or 0) <= 0:
            continue
        surfer = normalize_color(score["surfer"])
        if surfer not in entry_by_color:
            continue
        wave_number = int(score["wave_number"])
        judge_key = (score.get("judge_station") or score.get("judge_id") or "").strip().upper()
        if not judge_key:
            continue
        judge_keys.add(judge_key)
        created_key = score.get("created_at") or score.get("timestamp") or ""
        existing = grouped[surfer][wave_number].get(judge_key)
        if not existing or created_key >= existing["created_key"]:
            grouped[surfer][wave_number][judge_key] = {
                "score": float(score["score"]),
                "created_key": created_key,
            }

    judge_count = max(len(judge_keys), 1)
    effective = compute_effective_interferences(interference_calls, judge_count)
    interference_by_surfer = summarize_interference_by_surfer(effective)

    stats = []
    for surfer, waves in grouped.items():
        averages = []
        for wave_number in sorted(waves.keys()):
            judge_scores = [payload["score"] for payload in waves[wave_number].values()]
            if judge_scores:
                averages.append({"wave": wave_number, "score": calculate_score_average(judge_scores, judge_count)})

        averages = sorted(averages, key=lambda item: item["score"], reverse=True)
        wave_a = averages[0]["score"] if len(averages) > 0 else 0.0
        wave_b = averages[1]["score"] if len(averages) > 1 else 0.0
        summary = interference_by_surfer.get(surfer, {"count": 0, "type": None, "is_disqualified": False})
        if summary["is_disqualified"]:
            best_two = 0.0
        elif summary["type"] == "INT1":
            best_two = round(wave_a + (wave_b / 2), 2)
        elif summary["type"] == "INT2":
            best_two = round(wave_a, 2)
        else:
            best_two = round(wave_a + wave_b, 2)

        stats.append({"surfer": surfer, "best_two": best_two, "disqualified": summary["is_disqualified"]})

    eligible = sorted(
        [item for item in stats if not item["disqualified"]],
        key=lambda item: (-item["best_two"], item["surfer"]),
    )

    rank_map = {}
    current_rank = 0
    last_score = None
    for index, item in enumerate(eligible):
        if last_score is None or item["best_two"] != last_score:
            current_rank = index + 1
            last_score = item["best_two"]
        rank_map[current_rank] = {**entry_by_color[item["surfer"]], "best_two": item["best_two"]}

    return rank_map


def fetch_sequence(cur, event_id, division):
    cur.execute(
        """
        select id, round, heat_number, heat_size, color_order
        from public.heats
        where event_id = %s and upper(trim(division)) = upper(trim(%s))
        order by round asc, heat_number asc
        """,
        (event_id, division),
    )
    cols = [desc.name for desc in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]


def fetch_heat_entries(cur, heat_id):
    cur.execute(
        """
        select heat_id, participant_id, position, seed, color
        from public.heat_entries
        where heat_id = %s
        order by position asc
        """,
        (heat_id,),
    )
    cols = [desc.name for desc in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]


def fetch_heat_mappings(cur, heat_id):
    cur.execute(
        """
        select heat_id, position, placeholder, source_round, source_heat, source_position
        from public.heat_slot_mappings
        where heat_id = %s
        order by position asc
        """,
        (heat_id,),
    )
    cols = [desc.name for desc in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]


def fetch_heat_scores(cur, heat_id):
    cur.execute(
        """
        select heat_id, surfer, wave_number, score, judge_id, judge_station, timestamp, created_at
        from public.scores
        where heat_id = %s and coalesce(score,0) > 0
        order by created_at asc nulls last, timestamp asc nulls last
        """,
        (heat_id,),
    )
    cols = [desc.name for desc in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]


def fetch_interference_calls(cur, heat_id):
    cur.execute(
        """
        select judge_id, surfer, wave_number, call_type, is_head_judge_override, created_at, updated_at
        from public.interference_calls
        where heat_id = %s
        order by updated_at desc nulls last, created_at desc nulls last
        """,
        (heat_id,),
    )
    cols = [desc.name for desc in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]


def upsert_mappings(cur, mappings):
    for mapping in mappings:
        cur.execute(
            """
            insert into public.heat_slot_mappings (heat_id, position, placeholder, source_round, source_heat, source_position)
            values (%s, %s, %s, %s, %s, %s)
            on conflict (heat_id, position) do update
              set placeholder = excluded.placeholder,
                  source_round = excluded.source_round,
                  source_heat = excluded.source_heat,
                  source_position = excluded.source_position
            """,
            (
                mapping["heat_id"],
                mapping["position"],
                mapping["placeholder"],
                mapping["source_round"],
                mapping["source_heat"],
                mapping["source_position"],
            ),
        )


def apply_heat_updates(cur, target_heat, updates):
    color_order = list(target_heat.get("color_order") or [])
    for update in updates:
        position_index = int(update["position"]) - 1
        target_color = color_order[position_index] if position_index < len(color_order) else None
        seed_value = update["seed"] if update["seed"] is not None else int(update["position"])
        cur.execute(
            """
            update public.heat_entries
            set participant_id = %s,
                seed = %s,
                color = coalesce(%s, color)
            where heat_id = %s and position = %s
            """,
            (
                update["participant_id"],
                seed_value,
                target_color,
                target_heat["id"],
                update["position"],
            ),
        )


def repair_division(cur, event_id, event_name, division, rewrite_mappings=False):
    sequence = fetch_sequence(cur, event_id, division)
    if not sequence:
        return {"mappings": 0, "heats": 0}

    repaired_mappings = 0
    repaired_heats = 0

    for target_heat in sorted(sequence, key=lambda row: (int(row["round"]), int(row["heat_number"]))):
        if int(target_heat["round"]) <= 1:
            continue

        mappings = fetch_heat_mappings(cur, target_heat["id"])
        if rewrite_mappings or not mappings:
            inferred = infer_mappings(sequence, target_heat["id"])
            if inferred:
                upsert_mappings(cur, inferred)
                mappings = inferred
                repaired_mappings += len(inferred)

        if not mappings:
            continue

        updates = []
        for mapping in mappings:
            best_second_match = re.search(r"MEILLEUR\s*2E\s*R(\d+)", str(mapping.get("placeholder") or "").strip().upper())
            if best_second_match:
                best_second_round = int(best_second_match.group(1))
                candidates = []
                for heat in sequence:
                    if int(heat["round"]) != best_second_round:
                        continue
                    source_entries = fetch_heat_entries(cur, heat["id"])
                    source_scores = fetch_heat_scores(cur, heat["id"])
                    source_interference = fetch_interference_calls(cur, heat["id"])
                    qualifier = rank_surfer_stats(source_scores, source_entries, source_interference).get(2)
                    if qualifier:
                        candidates.append({**qualifier, "source_heat": int(heat["heat_number"])})

                best_second = next(
                    iter(sorted(
                        candidates,
                        key=lambda item: (
                            -float(item.get("best_two") or 0),
                            int(item.get("source_heat") or 0),
                            int(item.get("seed") or 9999),
                        ),
                    )),
                    None,
                )
                updates.append(
                    {
                        "position": int(mapping["position"]),
                        "participant_id": best_second["participant_id"] if best_second else None,
                        "seed": best_second["seed"] if best_second else int(mapping["position"]),
                    }
                )
                continue

            source_round = mapping.get("source_round")
            source_heat_number = mapping.get("source_heat")
            source_position = mapping.get("source_position")
            if source_round is None or source_heat_number is None or source_position is None:
                continue

            source_heat = next(
                (
                    heat
                    for heat in sequence
                    if int(heat["round"]) == int(source_round)
                    and int(heat["heat_number"]) == int(source_heat_number)
                ),
                None,
            )
            if not source_heat:
                continue

            source_entries = fetch_heat_entries(cur, source_heat["id"])
            source_scores = fetch_heat_scores(cur, source_heat["id"])
            source_interference = fetch_interference_calls(cur, source_heat["id"])
            rank_map = rank_surfer_stats(source_scores, source_entries, source_interference)
            qualifier = rank_map.get(int(source_position))

            updates.append(
                {
                    "position": int(mapping["position"]),
                    "participant_id": qualifier["participant_id"] if qualifier else None,
                    "seed": qualifier["seed"] if qualifier else int(mapping["position"]),
                }
            )

        if updates:
            apply_heat_updates(cur, target_heat, updates)
            repaired_heats += 1

    return {"mappings": repaired_mappings, "heats": repaired_heats}


def fetch_broken_divisions(cur, event_filter=None, include_assigned=False):
    where_clauses = []
    params = []
    if event_filter:
        where_clauses.append("(e.id = %s or lower(e.name) = lower(%s))")
        params.extend([event_filter, event_filter])

    sql = """
      with scored_heats as (
        select distinct s.heat_id
        from public.scores s
        where coalesce(s.score,0) > 0
      ), heat_entry_stats as (
        select he.heat_id,
               count(*) as total_slots,
               count(*) filter (where he.participant_id is not null) as assigned_slots
        from public.heat_entries he
        group by he.heat_id
      )
      select distinct h.event_id, e.name as event_name, h.division
      from public.heats h
      join scored_heats sh on sh.heat_id = h.id
      left join heat_entry_stats hes on hes.heat_id = h.id
      left join public.events e on e.id = h.event_id
      where coalesce(hes.total_slots,0) > 0
    """
    if not include_assigned:
        sql += " and coalesce(hes.assigned_slots,0) = 0"

    if where_clauses:
        sql += " and " + " and ".join(where_clauses)
    sql += " order by e.name nulls last, h.division"

    cur.execute(sql, params)
    return cur.fetchall()


def main():
    parser = argparse.ArgumentParser(description="Repair broken qualifier propagation from scores.")
    parser.add_argument("--event", help="Optional event id or exact event name filter")
    parser.add_argument("--rewrite-mappings", action="store_true", help="Rewrite existing inferred qualifier mappings before hydrating entries")
    parser.add_argument("--dry-run", action="store_true", help="Inspect only, do not write")
    args = parser.parse_args()

    db_url = os.environ.get("SUPABASE_DB_URL")
    if not db_url:
        raise SystemExit("SUPABASE_DB_URL is required")

    conn = psycopg.connect(db_url)
    conn.autocommit = False

    try:
        with conn.cursor() as cur:
            broken = fetch_broken_divisions(cur, args.event, args.rewrite_mappings)
            print(f"broken divisions: {len(broken)}")
            total_mappings = 0
            total_heats = 0

            for event_id, event_name, division in broken:
                print(f"repairing event={event_id} name={event_name} division={division}")
                if args.dry_run:
                    continue
                result = repair_division(cur, event_id, event_name, division, args.rewrite_mappings)
                total_mappings += result["mappings"]
                total_heats += result["heats"]
                print(f"  mappings={result['mappings']} heats={result['heats']}")

            if args.dry_run:
                conn.rollback()
                print("dry run complete")
            else:
                conn.commit()
                print(f"repair complete mappings={total_mappings} heats={total_heats}")
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
