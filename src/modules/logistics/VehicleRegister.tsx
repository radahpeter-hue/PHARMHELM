import React, { useState, useEffect } from 'react';
import { 
  Plus, Search, Filter, MoreVertical, Edit, Trash2, 
  Car, Calendar, Shield, Fuel, Settings, User
} from 'lucide-react';
import { db } from '../../firebase';
import { collection, query, where, onSnapshot, addDoc, updateDoc, deleteDoc, doc } from 'firebase/firestore';
import { useAuth } from '../../contexts/AuthContext';
import { Vehicle, Staff } from '../../types';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { cn } from '../../utils/cn';

export const VehicleRegister: React.FC = () => {
  const { profile } = useAuth();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [drivers, setDrivers] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<string>('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null);

  useEffect(() => {
    if (!profile?.tenantId) return;

    const vQuery = query(
      collection(db, 'vehicles'),
      where('tenantId', '==', profile.tenantId)
    );

    const dQuery = query(
      collection(db, 'staff'),
      where('tenantId', '==', profile.tenantId),
      where('role', 'in', ['Transport & Logistics Personnel', 'Logistics Head'])
    );

    const unsubscribeV = onSnapshot(vQuery, (snapshot) => {
      const vData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Vehicle));
      setVehicles(vData);
      setLoading(false);
    });

    const unsubscribeD = onSnapshot(dQuery, (snapshot) => {
      const dData = snapshot.docs.map(doc => ({ uid: doc.id, ...doc.data() } as Staff));
      setDrivers(dData);
    });

    return () => {
      unsubscribeV();
      unsubscribeD();
    };
  }, [profile?.tenantId]);

  const handleSave = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    
    const vehicleData = {
      plate_number: formData.get('plate_number') as string,
      vehicle_type: formData.get('vehicle_type') as any,
      brand_model: formData.get('brand_model') as string,
      year_of_manufacture: parseInt(formData.get('year_of_manufacture') as string),
      fuel_type: formData.get('fuel_type') as any,
      operational_mode: formData.get('operational_mode') as any,
      status: formData.get('status') as any,
      mileage: parseInt(formData.get('mileage') as string),
      insurance_expiry_date: formData.get('insurance_expiry_date') as string,
      logbook_number: formData.get('logbook_number') as string,
      assigned_driver_id: formData.get('assigned_driver_id') as string,
      last_service_date: formData.get('last_service_date') as string,
      next_service_date: formData.get('next_service_date') as string,
      tenantId: profile?.tenantId,
      created_at: editingVehicle?.created_at || new Date().toISOString(),
    };

    // Find driver name
    if (vehicleData.assigned_driver_id) {
      const driver = drivers.find(d => d.uid === vehicleData.assigned_driver_id);
      if (driver) {
        (vehicleData as any).assigned_driver_name = driver.full_name;
      }
    }

    try {
      if (editingVehicle) {
        await updateDoc(doc(db, 'vehicles', editingVehicle.id), vehicleData);
        toast.success('Vehicle updated successfully');
      } else {
        await addDoc(collection(db, 'vehicles'), vehicleData);
        toast.success('Vehicle added successfully');
      }
      setIsModalOpen(false);
      setEditingVehicle(null);
    } catch (error) {
      console.error('Error saving vehicle:', error);
      toast.error('Failed to save vehicle');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this vehicle?')) return;
    try {
      await deleteDoc(doc(db, 'vehicles', id));
      toast.success('Vehicle deleted successfully');
    } catch (error) {
      toast.error('Failed to delete vehicle');
    }
  };

  const filteredVehicles = vehicles.filter(v => {
    const matchesSearch = v.plate_number.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          v.brand_model.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesType = filterType === 'all' || v.vehicle_type === filterType;
    return matchesSearch && matchesType;
  });

  const getStatusStyles = (status: string) => {
    switch (status) {
      case 'available': return 'bg-emerald-100 text-emerald-700 border-emerald-200';
      case 'on-trip': return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'maintenance': return 'bg-amber-100 text-amber-700 border-amber-200';
      case 'out-of-service': return 'bg-rose-100 text-rose-700 border-rose-200';
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
            placeholder="Search by plate or model..."
            className="w-full pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-3">
          <select
            className="px-4 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
          >
            <option value="all">All Types</option>
            <option value="Motorcycle">Motorcycle</option>
            <option value="Saloon Car">Saloon Car</option>
            <option value="SUV">SUV</option>
            <option value="Van">Van</option>
            <option value="Truck">Truck</option>
          </select>
          <button
            onClick={() => {
              setEditingVehicle(null);
              setIsModalOpen(true);
            }}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors shadow-sm shadow-indigo-200"
          >
            <Plus className="h-4 w-4" />
            <span>Add Vehicle</span>
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-bottom border-slate-200">
                <th className="px-6 py-4 text-xs font-semibold text-slate-600 uppercase tracking-wider">Vehicle Details</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-600 uppercase tracking-wider">Type & Fuel</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-600 uppercase tracking-wider">Operational</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-600 uppercase tracking-wider">Status</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-600 uppercase tracking-wider text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-slate-500">Loading vehicles...</td>
                </tr>
              ) : filteredVehicles.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-slate-500">No vehicles found</td>
                </tr>
              ) : (
                filteredVehicles.map((vehicle) => (
                  <tr key={vehicle.id} className="hover:bg-slate-50/50 transition-colors group">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600">
                          <Car className="h-5 w-5" />
                        </div>
                        <div>
                          <div className="font-medium text-slate-900">{vehicle.plate_number}</div>
                          <div className="text-xs text-slate-500">{vehicle.brand_model} ({vehicle.year_of_manufacture})</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="space-y-1">
                        <div className="flex items-center gap-1.5 text-sm text-slate-700">
                          <Settings className="h-3.5 w-3.5 text-slate-400" />
                          {vehicle.vehicle_type}
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-slate-500">
                          <Fuel className="h-3 w-3 text-slate-400" />
                          {vehicle.fuel_type}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="space-y-1">
                        <div className="text-sm text-slate-700 font-medium">{vehicle.operational_mode}</div>
                        <div className="flex items-center gap-1.5 text-xs text-slate-500">
                          <User className="h-3 w-3 text-slate-400" />
                          {vehicle.assigned_driver_name || 'No driver assigned'}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={cn(
                        "px-2.5 py-1 rounded-full text-xs font-medium border",
                        getStatusStyles(vehicle.status)
                      )}>
                        {vehicle.status.replace('-', ' ')}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button 
                          onClick={() => {
                            setEditingVehicle(vehicle);
                            setIsModalOpen(true);
                          }}
                          className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                        >
                          <Edit className="h-4 w-4" />
                        </button>
                        <button 
                          onClick={() => handleDelete(vehicle.id)}
                          className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-900">
                {editingVehicle ? 'Edit Vehicle' : 'Add New Vehicle'}
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
                  <label className="text-sm font-medium text-slate-700">Plate Number</label>
                  <input
                    name="plate_number"
                    required
                    defaultValue={editingVehicle?.plate_number}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                    placeholder="e.g. UAX 123A"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700">Vehicle Type</label>
                  <select
                    name="vehicle_type"
                    required
                    defaultValue={editingVehicle?.vehicle_type || 'Saloon Car'}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  >
                    <option value="Motorcycle">Motorcycle</option>
                    <option value="Saloon Car">Saloon Car</option>
                    <option value="SUV">SUV</option>
                    <option value="Van">Van</option>
                    <option value="Truck">Truck</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700">Brand & Model</label>
                  <input
                    name="brand_model"
                    required
                    defaultValue={editingVehicle?.brand_model}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                    placeholder="e.g. Toyota Hilux"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700">Year of Manufacture</label>
                  <input
                    name="year_of_manufacture"
                    type="number"
                    required
                    defaultValue={editingVehicle?.year_of_manufacture || 2020}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700">Fuel Type</label>
                  <select
                    name="fuel_type"
                    required
                    defaultValue={editingVehicle?.fuel_type || 'Diesel'}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  >
                    <option value="Petrol">Petrol</option>
                    <option value="Diesel">Diesel</option>
                    <option value="Hybrid">Hybrid</option>
                    <option value="Electric">Electric</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700">Operational Mode</label>
                  <select
                    name="operational_mode"
                    required
                    defaultValue={editingVehicle?.operational_mode || 'Owned'}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  >
                    <option value="Owned">Owned</option>
                    <option value="Leased">Leased</option>
                    <option value="Third-Party">Third-Party</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700">Current Status</label>
                  <select
                    name="status"
                    required
                    defaultValue={editingVehicle?.status || 'available'}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  >
                    <option value="available">Available</option>
                    <option value="on-trip">On Trip</option>
                    <option value="maintenance">Maintenance</option>
                    <option value="out-of-service">Out of Service</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700">Current Mileage (km)</label>
                  <input
                    name="mileage"
                    type="number"
                    required
                    defaultValue={editingVehicle?.mileage || 0}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700">Assigned Driver</label>
                  <select
                    name="assigned_driver_id"
                    defaultValue={editingVehicle?.assigned_driver_id}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  >
                    <option value="">No Driver Assigned</option>
                    {drivers.map(d => (
                      <option key={d.uid} value={d.uid}>{d.full_name}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700">Logbook Number</label>
                  <input
                    name="logbook_number"
                    defaultValue={editingVehicle?.logbook_number}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700">Insurance Expiry</label>
                  <input
                    name="insurance_expiry_date"
                    type="date"
                    defaultValue={editingVehicle?.insurance_expiry_date}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700">Last Service Date</label>
                  <input
                    name="last_service_date"
                    type="date"
                    defaultValue={editingVehicle?.last_service_date}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700">Next Service Date</label>
                  <input
                    name="next_service_date"
                    type="date"
                    defaultValue={editingVehicle?.next_service_date}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  />
                </div>
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
                  {editingVehicle ? 'Update Vehicle' : 'Add Vehicle'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
