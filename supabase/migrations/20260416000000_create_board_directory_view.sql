-- Create view for Board Members Directory with logic to avoid duplicate profiles
-- (picks only one unit per board member, the most recently assigned one)
CREATE VIEW board_members_directory AS
SELECT DISTINCT ON (bm.id)
  bm.id as member_id,
  bm.role,
  bm.building_id,
  p.id as profile_id,
  p.name as profile_name,
  p.email as profile_email,
  p.phone as profile_phone,
  u.id as unit_id,
  u.name as unit_name,
  pu.created_at as unit_assigned_at
FROM building_members bm
LEFT JOIN profiles p ON bm.profile_id = p.id
LEFT JOIN profile_units pu ON p.id = pu.profile_id
LEFT JOIN units u ON pu.unit_id = u.id
WHERE bm.role = 'board'
ORDER BY bm.id, pu.created_at DESC;

-- Add RLS description or policies if needed, but views in Supabase 
-- usually follow the underlying table policies or require explicit grant.
GRANT SELECT ON board_members_directory TO authenticated;
GRANT SELECT ON board_members_directory TO service_role;
