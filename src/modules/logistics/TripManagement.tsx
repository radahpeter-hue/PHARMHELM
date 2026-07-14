import React, { useState, useEffect } from 'react';
import { 
  Plus, Search, Filter, MoreVertical, Edit, Trash2, 
  MapPin, Clock, Calendar, Navigation, CheckCircle2, 
  AlertCircle, XCircle, ChevronRight, ChevronDown, Map, Car, User
} from 'lucide-react';
import { db } from '../../firebase';
import { collection, query, where, onSnapshot, addDoc, updateDoc, deleteDoc, doc, getDocs } from 'firebase/firestore';
import { useAuth } from '../../contexts/AuthContext';
import { Trip, TripLeg, Vehicle, Staff } from '../../types';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { cn } from '../../utils/cn';

export const TripManagement: React.FC = () => {
  const { profile } = useAuth();
  const [trips, setTrips] = useState<Trip[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [drivers, setDrivers] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTrip, setEditingTrip] = useState<Trip | null>(null);
  const [expandedTrip, setExpandedTrip] = useState<string | null>(null);
  const [tripLegs, setTripLegs] = useState<Record<string, TripLeg[]>>({});

  useEffect(() => {
    if (!profile?.tenantId) return;

    const tQuery = query(
      collection(db, 'trips'),
      where('tenantId', '==', profile.tenantId)
    );

    const vQuery = query(
      collection(db, 'vehicles'),
      where('tenantId', '==', profile.tenantId),
      where('status', '==', 'available')
    );

    const dQuery = query(
      collection(db, 'staff'),
      where('tenantId', '==', profile.tenantId),
      where('role', 'in', ['Transport & Logistics Personnel', 'Logistics Head'])
    );

    const unsubscribeT = onSnapshot(tQuery, (snapshot) => {
      const tData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Trip));
      setTrips(tData);
      setLoading(false);
    });

    const unsubscribeV = onSnapshot(vQuery, (snapshot) => {
      const vData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Vehicle));
      setVehicles(vData);
    });

    const unsubscribeD = onSnapshot(dQuery, (snapshot) => {
      const dData = snapshot.docs.map(doc => ({ uid: doc.id, ...doc.data() } as Staff));
      setDrivers(dData);
    });

    return () => {
      unsubscribeT();
      unsubscribeV();
      unsubscribeD();
    };
  }, [profile?.tenantId]);

  const fetchLegs = async (tripId: string) => {
    if (tripLegs[tripId]) return;
    const q = query(collection(db, 'trip_legs'), where('tripId', '==', tripId));
    const snapshot = await getDocs(q);
    const legs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as TripLeg));
    setTripLegs(prev => ({ ...prev, [tripId]: legs }));
  };

  const handleSave = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    
    const vehicleId = formData.get('vehicleId') as string;
    const vehicle = vehicles.find(v => v.id === vehicleId) || (editingTrip ? { plate_number: editingTrip.vehicle_plate } : null);
    const driverId = formData.get('driver_id') as string;
    const driver = drivers.find(d => d.uid === driverId) || (editingTrip ? { full_name: editingTrip.driver_name } : null);

    const tripData = {
      vehicleId,
      vehicle_plate: vehicle?.plate_number || '',
      driver_id: driverId,
      driver_name: (driver as any)?.full_name || '',
      route_origin: formData.get('route_origin') as string,
      route_destination: formData.get('route_destination') as string,
      departure_time: formData.get('departure_time') as string,
      arrival_time: formData.get('arrival_time') as string || null,
      start_mileage: parseInt(formData.get('start_mileage') as string),
      end_mileage: formData.get('end_mileage') ? parseInt(formData.get('end_mileage') as string) : null,
      status: formData.get('status') as any,
      purpose: formData.get('purpose') as string,
      notes: formData.get('notes') as string,
      tenantId: profile?.tenantId,
      created_at: editingTrip?.created_at || new Date().toISOString(),
    };

    try {
      if (editingTrip) {
        await updateDoc(doc(db, 'trips', editingTrip.id), tripData);
        toast.success('Trip updated successfully');
      } else {
        await addDoc(collection(db, 'trips'), tripData);
        // Update vehicle status
        if (vehicleId) {
          await updateDoc(doc(db, 'vehicles', vehicleId), { status: 'on-trip' });
        }
        toast.success('Trip created successfully');
      }
      setIsModalOpen(false);
      setEditingTrip(null);
    } catch (error) {
      console.error('Error saving trip:', error);
      toast.error('Failed to save trip');
    }
  };

  const handleStatusChange = async (trip: Trip, newStatus: string) => {
    try {
      await updateDoc(doc(db, 'trips', trip.id), { status: newStatus });
      if (newStatus === 'completed') {
        await updateDoc(doc(db, 'vehicles', trip.vehicleId), { status: 'available' });
      }
      toast.success(`Trip marked as ${newStatus}`);
    } catch (error) {
      toast.error('Failed to update status');
    }
  };

  const filteredTrips = trips.filter(t => 
    t.vehicle_plate.toLowerCase().includes(searchTerm.toLowerCase()) || 
    t.driver_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    t.route_destination.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getStatusStyles = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-amber-100 text-amber-700 border-amber-200';
      case 'in-progress': return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'completed': return 'bg-emerald-100 text-emerald-700 border-emerald-200';
      case 'cancelled': return 'bg-rose-100 text-rose-700 border-rose-200';
      default: return 'bg-slate-100 text-slate-700 border-slate-200';
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search trips by plate, driver or destination..."
            className="w-full pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <button
          onClick={() => {
            setEditingTrip(null);
            setIsModalOpen(true);
          }}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors shadow-sm shadow-indigo-200"
        >
          <Plus className="h-4 w-4" />
          <span>New Trip</span>
        </button>
      </div>

      <div className="space-y-4">
        {loading ? (
          <div className="py-12 text-center text-slate-500 bg-white rounded-xl border border-slate-200">Loading trips...</div>
        ) : filteredTrips.length === 0 ? (
          <div className="py-12 text-center text-slate-500 bg-white rounded-xl border border-slate-200">No trips found</div>
        ) : (
          filteredTrips.map((trip) => (
            <div key={trip.id} className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm hover:shadow-md transition-shadow">
              <div className="p-6">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
                  <div className="flex items-start gap-4">
                    <div className="h-12 w-12 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600 shrink-0">
                      <Navigation className="h-6 w-6" />
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <h4 className="font-semibold text-slate-900">{trip.route_origin}</h4>
                        <ChevronRight className="h-4 w-4 text-slate-400" />
                        <h4 className="font-semibold text-slate-900">{trip.route_destination}</h4>
                      </div>
                      <div className="flex items-center gap-4 text-sm text-slate-500">
                        <span className="flex items-center gap-1.5">
                          <Car className="h-3.5 w-3.5" />
                          {trip.vehicle_plate}
                        </span>
                        <span className="flex items-center gap-1.5">
                          <User className="h-3.5 w-3.5" />
                          {trip.driver_name}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-6">
                    <div className="space-y-1">
                      <div className="text-xs font-medium text-slate-400 uppercase tracking-wider">Departure</div>
                      <div className="flex items-center gap-1.5 text-sm text-slate-700">
                        <Calendar className="h-3.5 w-3.5 text-slate-400" />
                        {format(new Date(trip.departure_time), 'MMM d, HH:mm')}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-xs font-medium text-slate-400 uppercase tracking-wider">Status</div>
                      <span className={cn(
                        "px-2.5 py-1 rounded-full text-xs font-medium border block w-fit",
                        getStatusStyles(trip.status)
                      )}>
                        {trip.status.replace('-', ' ')}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {trip.status === 'pending' && (
                        <button 
                          onClick={() => handleStatusChange(trip, 'in-progress')}
                          className="px-3 py-1.5 text-xs font-semibold bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors"
                        >
                          Start Trip
                        </button>
                      )}
                      {trip.status === 'in-progress' && (
                        <button 
                          onClick={() => handleStatusChange(trip, 'completed')}
                          className="px-3 py-1.5 text-xs font-semibold bg-emerald-50 text-emerald-600 rounded-lg hover:bg-emerald-100 transition-colors"
                        >
                          Complete
                        </button>
                      )}
                      <button 
                        onClick={() => {
                          if (expandedTrip === trip.id) {
                            setExpandedTrip(null);
                          } else {
                            setExpandedTrip(trip.id);
                            fetchLegs(trip.id);
                          }
                        }}
                        className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                      >
                        {expandedTrip === trip.id ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {expandedTrip === trip.id && (
                <div className="px-6 pb-6 border-t border-slate-50 bg-slate-50/30">
                  <div className="mt-4 space-y-4">
                    <div className="flex items-center justify-between">
                      <h5 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                        <Map className="h-4 w-4" />
                        Trip Legs
                      </h5>
                      <button className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 flex items-center gap-1">
                        <Plus className="h-3 w-3" />
                        Add Leg
                      </button>
                    </div>
                    
                    <div className="space-y-3">
                      {tripLegs[trip.id]?.length === 0 ? (
                        <div className="text-xs text-slate-500 italic">No intermediate legs recorded</div>
                      ) : (
                        tripLegs[trip.id]?.map((leg, idx) => (
                          <div key={leg.id} className="bg-white p-3 rounded-lg border border-slate-200 flex items-center justify-between">
                            <div className="flex items-center gap-4">
                              <div className="h-6 w-6 rounded-full bg-slate-100 flex items-center justify-center text-[10px] font-bold text-slate-500">
                                {idx + 1}
                              </div>
                              <div className="text-sm">
                                <span className="font-medium text-slate-900">{leg.origin}</span>
                                <span className="mx-2 text-slate-400">→</span>
                                <span className="font-medium text-slate-900">{leg.destination}</span>
                              </div>
                            </div>
                            <div className="flex items-center gap-4 text-xs text-slate-500">
                              <span>{format(new Date(leg.departure_time), 'HH:mm')}</span>
                              <span className={cn(
                                "px-2 py-0.5 rounded-full border",
                                leg.status === 'completed' ? "bg-emerald-50 text-emerald-600 border-emerald-100" : "bg-amber-50 text-amber-600 border-amber-100"
                              )}>
                                {leg.status}
                              </span>
                            </div>
                          </div>
                        ))
                      )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
                      <div className="bg-white p-4 rounded-lg border border-slate-200 space-y-3">
                        <h6 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Trip Details</h6>
                        <div className="space-y-2">
                          <div className="flex justify-between text-sm">
                            <span className="text-slate-500">Purpose</span>
                            <span className="text-slate-900 font-medium">{trip.purpose}</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-slate-500">Start Mileage</span>
                            <span className="text-slate-900 font-medium">{trip.start_mileage} km</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-slate-500">End Mileage</span>
                            <span className="text-slate-900 font-medium">{trip.end_mileage || '--'} km</span>
                          </div>
                        </div>
                      </div>
                      <div className="bg-white p-4 rounded-lg border border-slate-200 space-y-3">
                        <h6 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Notes</h6>
                        <p className="text-sm text-slate-600 leading-relaxed">
                          {trip.notes || 'No additional notes provided for this trip.'}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-900">
                {editingTrip ? 'Edit Trip' : 'Create New Trip'}
              </h3>
              <button 
                onClick={() => setIsModalOpen(false)}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <Plus className="h-5 w-5 rotate-45" />
              </button>
            </div>
            
            <form onSubmit={handleSave} className="flex-1 overflow-y-auto p-6 space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700">Vehicle</label>
                  <select
                    name="vehicleId"
                    required
                    defaultValue={editingTrip?.vehicleId}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  >
                    <option value="">Select Vehicle</option>
                    {vehicles.map(v => (
                      <option key={v.id} value={v.id}>{v.plate_number} - {v.brand_model}</option>
                    ))}
                    {editingTrip && !vehicles.find(v => v.id === editingTrip.vehicleId) && (
                      <option value={editingTrip.vehicleId}>{editingTrip.vehicle_plate} (Current)</option>
                    )}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700">Driver</label>
                  <select
                    name="driver_id"
                    required
                    defaultValue={editingTrip?.driver_id}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  >
                    <option value="">Select Driver</option>
                    {drivers.map(d => (
                      <option key={d.uid} value={d.uid}>{d.full_name}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700">Origin</label>
                  <input
                    name="route_origin"
                    required
                    defaultValue={editingTrip?.route_origin}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                    placeholder="e.g. HQ Warehouse"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700">Destination</label>
                  <input
                    name="route_destination"
                    required
                    defaultValue={editingTrip?.route_destination}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                    placeholder="e.g. Entebbe Branch"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700">Departure Time</label>
                  <input
                    name="departure_time"
                    type="datetime-local"
                    required
                    defaultValue={editingTrip?.departure_time ? format(new Date(editingTrip.departure_time), "yyyy-MM-dd'T'HH:mm") : ''}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700">Arrival Time (Optional)</label>
                  <input
                    name="arrival_time"
                    type="datetime-local"
                    defaultValue={editingTrip?.arrival_time ? format(new Date(editingTrip.arrival_time), "yyyy-MM-dd'T'HH:mm") : ''}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700">Start Mileage (km)</label>
                  <input
                    name="start_mileage"
                    type="number"
                    required
                    defaultValue={editingTrip?.start_mileage || 0}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700">End Mileage (km)</label>
                  <input
                    name="end_mileage"
                    type="number"
                    defaultValue={editingTrip?.end_mileage || ''}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700">Trip Status</label>
                  <select
                    name="status"
                    required
                    defaultValue={editingTrip?.status || 'pending'}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  >
                    <option value="pending">Pending</option>
                    <option value="in-progress">In Progress</option>
                    <option value="completed">Completed</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700">Purpose</label>
                  <input
                    name="purpose"
                    required
                    defaultValue={editingTrip?.purpose}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                    placeholder="e.g. Stock Delivery"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700">Notes</label>
                <textarea
                  name="notes"
                  rows={3}
                  defaultValue={editingTrip?.notes}
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 resize-none"
                  placeholder="Additional trip details..."
                />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors shadow-sm shadow-indigo-200"
                >
                  {editingTrip ? 'Update Trip' : 'Create Trip'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
