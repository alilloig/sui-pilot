module showcase::vec_map;

use prover::prover::{ensures, clone, requires};

use sui::vec_map;

fun deconstruct_and_reconstruct(m: vec_map::VecMap<u64, u8>): vec_map::VecMap<u64, u8> {
  let (keys, values) = m.into_keys_values();
  vec_map::from_keys_values(keys, values)
}

#[spec(prove)]
fun deconstruct_and_reconstruct_preserves_map(m: vec_map::VecMap<u64, u8>): vec_map::VecMap<u64, u8> {
  let old_m = clone!(&m);
  let result = deconstruct_and_reconstruct(m);
  ensures(&result == old_m);
  result
}

fun insert_key(m: &mut vec_map::VecMap<u64, u8>) {
  m.insert(10, 0);
}

#[spec(prove)]
fun insert_key_value_spec(m: &mut vec_map::VecMap<u64, u8>) {
  requires(!m.contains(&10));
  insert_key(m);
  ensures(m.get(&10) == 0);
}

#[spec(prove)]
fun verify_map_properties(m: &vec_map::VecMap<u64, u8>) {
  ensures(m.keys().length() == m.size());
  ensures(m.keys().contains(&10) == m.contains(&10));
}
