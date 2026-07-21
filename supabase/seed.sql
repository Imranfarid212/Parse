insert into public.categories (id, name, is_default, is_system) values
  (1, 'Travel & Transit', true, false),
  (2, 'Meals & Entertainment', true, false),
  (3, 'Office Supplies', true, false),
  (4, 'Software & IT', true, false),
  (5, 'Vehicle Expenses', true, false),
  (6, 'Advertising & Marketing', true, false),
  (7, 'Professional Services', true, false),
  (8, 'Utilities & Telecom', true, false),
  (9, 'Inventory & Materials', true, false),
  (10, 'Miscellaneous', true, true)
on conflict (id) do update set
  name = excluded.name,
  is_default = excluded.is_default,
  is_system = excluded.is_system;
