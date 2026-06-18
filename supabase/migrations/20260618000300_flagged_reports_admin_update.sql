-- Allow authenticated admins to update flagged_reports status.
-- Uses the same admins table check pattern as other admin policies.
CREATE POLICY "Admins can update flag status"
  ON flagged_reports FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM admins WHERE proton_pulse_user_id = auth.uid())
  )
  WITH CHECK (true);
