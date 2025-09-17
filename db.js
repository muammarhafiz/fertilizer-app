import { supabase } from "./supabaseClient";

export async function currentUser() {
  const { data } = await supabase.auth.getUser();
  return data.user;
}

export async function listFertilizers() {
  const { data, error } = await supabase
    .from("fertilizers").select("*").order("name");
  if (error) throw error;
  return data;
}

export async function createFertilizer({ name, bag_size_kg, price_per_bag, npk = {}, micro = {} }) {
  const user = await currentUser();
  const { data, error } = await supabase
    .from("fertilizers")
    .insert([{ owner: user.id, name, bag_size_kg, price_per_bag, npk, micro }])
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateFertilizer(id, patch) {
  const { data, error } = await supabase
    .from("fertilizers")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteFertilizer(id) {
  const { error } = await supabase.from("fertilizers").delete().eq("id", id);
  if (error) throw error;
}
