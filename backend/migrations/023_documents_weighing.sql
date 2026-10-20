-- Pièces jointes (ticket, photo) sur une pesée.
ALTER TABLE documents DROP CONSTRAINT documents_subject_type_check;
ALTER TABLE documents ADD CONSTRAINT documents_subject_type_check CHECK (subject_type IN
  ('producer','collector','declaration','lot','receipt','payment','inspection','certificate','loan','parcel','task','shipment','order','invoice','claim','weighing'));
