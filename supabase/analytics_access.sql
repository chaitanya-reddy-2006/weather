-- Run in the Supabase SQL Editor after creating public.raspberry_pi_readings.
-- Allows authenticated users to issue SELECT, while RLS limits returned rows to admins.
GRANT SELECT ON TABLE public.raspberry_pi_readings TO authenticated;

DROP POLICY IF EXISTS "Admins can read Raspberry Pi readings" ON public.raspberry_pi_readings;
CREATE POLICY "Admins can read Raspberry Pi readings"
ON public.raspberry_pi_readings
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.admin_users
    WHERE user_id = auth.uid()
  )
);
