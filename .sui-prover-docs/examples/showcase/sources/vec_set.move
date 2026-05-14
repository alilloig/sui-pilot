module showcase::vec_set;

use prover::prover::{ensures, clone, requires};

use sui::vec_set;

fun from_keys_preserves_identity(s: vec_set::VecSet<u64>): vec_set::VecSet<u64> {
    vec_set::from_keys(s.into_keys())
}

#[spec(prove)]
fun from_keys_preserves_identity_spec(s: vec_set::VecSet<u64>): vec_set::VecSet<u64> {
  let old_s = clone!(&s);
  let result = from_keys_preserves_identity(s);
  ensures(&result == old_s);
  result
}


fun insert_new_element(s: &mut vec_set::VecSet<u64>) {
  s.insert(10);
}

#[spec(prove)]
fun insert_new_element_spec(s: &mut vec_set::VecSet<u64>) {
  requires(!s.contains(&10));
  insert_new_element(s);
  ensures(s.contains(&10));
}

fun remove_existing_element(s: &mut vec_set::VecSet<u64>) {
  s.remove(&10);
}

#[spec(prove)]
fun remove_existing_element_spec(s: &mut vec_set::VecSet<u64>) {
  requires(s.contains(&10));
  remove_existing_element(s);
  ensures(!s.contains(&10));
}