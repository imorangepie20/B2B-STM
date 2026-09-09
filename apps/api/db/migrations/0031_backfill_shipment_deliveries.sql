INSERT INTO shipment_deliveries(shipment_id,status,updated_by,updated_at)
SELECT s.id,'ready',s.shipped_by,s.shipped_at FROM shipments s LEFT JOIN shipment_deliveries d ON d.shipment_id=s.id WHERE d.shipment_id IS NULL;
INSERT INTO shipment_delivery_events(id,shipment_id,event_type,actor_id,to_status,created_at)
SELECT gen_random_uuid(),s.id,'created',s.shipped_by,'ready',s.shipped_at FROM shipments s WHERE NOT EXISTS(SELECT 1 FROM shipment_delivery_events e WHERE e.shipment_id=s.id);
