import React, { useState, useEffect, useMemo } from 'react';
import { Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Line, ComposedChart } from 'recharts';
import { Clock, ArrowRightLeft, ShieldCheck, User, DollarSign } from 'lucide-react';
import { cn } from '../../utils/cn';
import { useAuth } from '../../contexts/AuthContext';
import { firestoreService } from '../../services/firestore';

const amount = (...values: any[]) => Number(values.find(value => Number.isFinite(Number(value))) || 0);
const dateValue = (value: any) => value?.toDate?.() || (value ? new Date(value) : null);
const daysUntil = (value: any) => {
  const date = dateValue(value);
  return date && !Number.isNaN(date.getTime()) ? Math.ceil((date.getTime() - Date.now()) / 86400000) : null;
};

export const LogisticsAnalytics: React.FC = () => {
  const { profile } = useAuth();
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [trips, setTrips] = useState<any[]>([]);
  const [fuelLogs, setFuelLogs] = useState<any[]>([]);
  const [maintenanceLogs, setMaintenanceLogs] = useState<any[]>([]);
  const [fineLogs, setFineLogs] = useState<any[]>([]);
  const [generalExpenses, setGeneralExpenses] = useState<any[]>([]);
  const [sales, setSales] = useState<any[]>([]);
  const [staff, setStaff] = useState<any[]>([]);

  useEffect(() => {
    if (profile?.tenantId) {
      const unsubscribers = [
        firestoreService.subscribeToCollection('vehicles', profile.tenantId, setVehicles),
        firestoreService.subscribeToCollection('trips', profile.tenantId, setTrips),
        firestoreService.subscribeToCollection('fuel_logs', profile.tenantId, setFuelLogs),
        firestoreService.subscribeToCollection('maintenance_logs', profile.tenantId, setMaintenanceLogs),
        firestoreService.subscribeToCollection('traffic_fine_logs', profile.tenantId, setFineLogs),
        firestoreService.subscribeToCollection('logistics_expenses', profile.tenantId, setGeneralExpenses),
        firestoreService.subscribeToCollection('sales', profile.tenantId, setSales),
        firestoreService.subscribeToCollection('staff', profile.tenantId, setStaff)
      ];
      return () => unsubscribers.forEach(unsubscribe => unsubscribe());
    }
  }, [profile?.tenantId]);

  const metrics = useMemo(() => {
    const vehicleMap = new Map(vehicles.map(vehicle => [vehicle.id, vehicle]));
    const staffMap = new Map<string, any>();
    staff.forEach(person => {
      staffMap.set(person.uid || person.id, person);
      if (person.legacyStaffId) staffMap.set(person.legacyStaffId, person);
    });
    const costsByVehicle = new Map<string, number>();
    const addVehicleCost = (record: any, value: number) => {
      const id = record.vehicleId || record.vehicle_id;
      if (id) costsByVehicle.set(id, (costsByVehicle.get(id) || 0) + value);
    };
    fuelLogs.forEach(log => addVehicleCost(log, amount(log.cost_ugx, log.amount)));
    maintenanceLogs.forEach(log => addVehicleCost(log, amount(log.cost_ugx, log.cost, log.amount)));
    fineLogs.forEach(log => addVehicleCost(log, amount(log.fine_amount_ugx, log.amount)));
    generalExpenses.forEach(log => addVehicleCost(log, amount(log.cost_ugx, log.amount)));

    const distanceByVehicle = new Map<string, number>();
    trips.forEach(trip => {
      const distance = Math.max(0, amount(trip.end_mileage) - amount(trip.start_mileage));
      if (trip.vehicleId && distance > 0) distanceByVehicle.set(trip.vehicleId, (distanceByVehicle.get(trip.vehicleId) || 0) + distance);
    });
    const totalCost = [...costsByVehicle.values()].reduce((sum, value) => sum + value, 0);
    const totalDistance = [...distanceByVehicle.values()].reduce((sum, value) => sum + value, 0);
    const averageOpex = totalDistance > 0 ? totalCost / totalDistance : 0;
    const vehicleOpex = vehicles.map(vehicle => {
      const distance = distanceByVehicle.get(vehicle.id) || 0;
      return {
        vehicle: vehicle.plate_number || vehicle.numberPlate || vehicle.name || vehicle.id,
        opex: distance > 0 ? Math.round((costsByVehicle.get(vehicle.id) || 0) / distance) : 0,
        avg: Math.round(averageOpex)
      };
    }).filter(vehicle => vehicle.opex > 0);

    const completedTrips = trips.filter(trip => trip.status === 'completed' && trip.departure_time && trip.arrival_time);
    const tatHours = completedTrips.map(trip => {
      const start = dateValue(trip.departure_time);
      const end = dateValue(trip.arrival_time);
      return start && end ? Math.max(0, (end.getTime() - start.getTime()) / 3600000) : 0;
    }).filter(Boolean);
    const averageTat = tatHours.length ? tatHours.reduce((sum, value) => sum + value, 0) / tatHours.length : 0;

    const totalRevenue = sales.filter(sale => sale.status !== 'voided').reduce((sum, sale) => sum + amount(sale.total, sale.total_amount, sale.amount), 0);
    const logisticsCostPercent = totalRevenue > 0 ? (totalCost / totalRevenue) * 100 : 0;
    const transitValue = trips.reduce((sum, trip) => sum + amount(trip.cargo_value_ugx, trip.delivery_value_ugx), 0);
    const transitLoss = trips.reduce((sum, trip) => sum + amount(trip.transit_loss_ugx, trip.shrinkage_value_ugx), 0);
    const shrinkageRate = transitValue > 0 ? (transitLoss / transitValue) * 100 : 0;

    const complianceList = vehicles.flatMap(vehicle => {
      const name = vehicle.plate_number || vehicle.numberPlate || vehicle.name || vehicle.id;
      return [
        { name, item: 'Insurance', days: daysUntil(vehicle.insurance_expiry_date) },
        { name, item: 'Service', days: daysUntil(vehicle.next_service_date) }
      ];
    }).filter(item => item.days !== null && item.days <= 60)
      .map(item => ({ ...item, days: item.days as number, status: (item.days as number) <= 14 ? 'Critical' : 'Warning' }))
      .sort((a, b) => a.days - b.days);

    const routes = new Map<string, { route: string; revenue: number; cost: number; profit: number }>();
    trips.forEach(trip => {
      const routeName = `${trip.route_origin || 'Origin'} - ${trip.route_destination || 'Destination'}`;
      const existing = routes.get(routeName) || { route: routeName, revenue: 0, cost: 0, profit: 0 };
      existing.revenue += amount(trip.revenue_ugx, trip.delivery_revenue_ugx);
      existing.cost += amount(trip.cost_ugx, trip.trip_cost_ugx);
      existing.profit = existing.revenue - existing.cost;
      routes.set(routeName, existing);
    });

    const drivers = new Map<string, any>();
    trips.forEach(trip => {
      const id = trip.driver_id || trip.personnelId || trip.driver_name;
      if (!id) return;
      const person = staffMap.get(id);
      const current = drivers.get(id) || { name: trip.driver_name || person?.full_name || id, trips: 0, hours: 0, timedTrips: 0, incidents: 0 };
      current.trips += 1;
      const start = dateValue(trip.departure_time);
      const end = dateValue(trip.arrival_time);
      if (start && end) { current.hours += Math.max(0, (end.getTime() - start.getTime()) / 3600000); current.timedTrips += 1; }
      drivers.set(id, current);
    });
    fineLogs.forEach(fine => {
      const id = fine.driver_id || fine.personnelId || fine.staff_id;
      if (id && drivers.has(id)) drivers.get(id).incidents += 1;
    });
    const driverList = [...drivers.values()].map(driver => ({
      ...driver,
      tat: driver.timedTrips ? `${(driver.hours / driver.timedTrips).toFixed(1)}h` : 'N/A',
      status: driver.incidents === 0 ? 'Normal' : driver.incidents >= 3 ? 'Warning' : 'Review'
    }));

    return {
      vehicleOpex,
      averageTat,
      shrinkageRate,
      logisticsCostPercent,
      complianceList,
      routeList: [...routes.values()],
      driverList
    };
  }, [vehicles, trips, fuelLogs, maintenanceLogs, fineLogs, generalExpenses, sales, staff]);
  return (
    <div className="space-y-8">
      {/* Live KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white p-6 rounded-3xl border border-zinc-200 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="h-10 w-10 bg-emerald-50 rounded-xl flex items-center justify-center">
              <Clock className="text-emerald-600" size={20} />
            </div>
            <div className="text-emerald-600 text-xs font-bold">{metrics.averageTat.toFixed(1)}h</div>
          </div>
          <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-1">Delivery TAT (Avg)</p>
          <h3 className="text-2xl font-black text-zinc-900">{metrics.averageTat.toFixed(1)} hours</h3>
          <p className="text-[10px] text-zinc-400 mt-1">From POS checkout to receipt</p>
        </div>

        <div className="bg-white p-6 rounded-3xl border border-zinc-200 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="h-10 w-10 bg-blue-50 rounded-xl flex items-center justify-center">
              <ArrowRightLeft className="text-blue-600" size={20} />
            </div>
            <div className="text-blue-600 text-xs font-bold">{metrics.shrinkageRate.toFixed(1)}%</div>
          </div>
          <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-1">Transit Shrinkage Rate</p>
          <h3 className="text-2xl font-black text-zinc-900">{metrics.shrinkageRate.toFixed(1)}%</h3>
          <p className="text-[10px] text-zinc-400 mt-1">Risk threshold: 0.5%</p>
        </div>

        <div className="bg-white p-6 rounded-3xl border border-zinc-200 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="h-10 w-10 bg-amber-50 rounded-xl flex items-center justify-center">
              <DollarSign className="text-amber-600" size={20} />
            </div>
            <div className="text-amber-600 text-xs font-bold">{metrics.logisticsCostPercent.toFixed(1)}%</div>
          </div>
          <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-1">Logistics Cost % Revenue</p>
          <h3 className="text-2xl font-black text-zinc-900">{metrics.logisticsCostPercent.toFixed(1)}%</h3>
          <p className="text-[10px] text-zinc-400 mt-1">Total transport costs ÷ revenue</p>
        </div>

        <div className="bg-white p-6 rounded-3xl border border-zinc-200 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="h-10 w-10 bg-red-50 rounded-xl flex items-center justify-center">
              <ShieldCheck className="text-red-600" size={20} />
            </div>
            <div className="text-red-600 text-xs font-bold">{metrics.complianceList.length} vehicles</div>
          </div>
          <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-1">Fleet Compliance Alert</p>
          <h3 className="text-2xl font-black text-zinc-900">{metrics.complianceList.length} alerts</h3>
          <p className="text-[10px] text-zinc-400 mt-1">Maintenance/Insurance due</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Vehicle OpEx vs Mileage */}
        <div className="lg:col-span-2 bg-white p-8 rounded-3xl border border-zinc-200 shadow-sm">
          <h3 className="text-lg font-bold text-zinc-900 mb-8">Vehicle OpEx vs Mileage</h3>
          <div className="h-[300px] w-full">
            {metrics.vehicleOpex.length === 0 ? (
              <div className="h-full flex items-center justify-center text-zinc-400 text-sm">
                No active fleet mileage logs.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={metrics.vehicleOpex}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis 
                    dataKey="vehicle" 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fontSize: 12, fill: '#64748b' }} 
                  />
                  <YAxis 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fontSize: 12, fill: '#64748b' }} 
                    tickFormatter={(value) => `UGX ${value}`}
                  />
                  <Tooltip 
                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                    formatter={(value: any) => [`UGX ${value}/km`, 'OpEx']}
                  />
                  <Bar dataKey="opex" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  <Line type="monotone" dataKey="avg" stroke="#ef4444" strokeDasharray="5 5" dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Fleet Compliance Countdown */}
        <div className="bg-white p-8 rounded-3xl border border-zinc-200 shadow-sm">
          <h3 className="text-lg font-bold text-zinc-900 mb-2">Fleet Compliance Countdown</h3>
          <p className="text-sm text-zinc-500 mb-8">Days remaining for vehicle compliance</p>
          <div className="space-y-4">
            {(() => {
              const complianceList = metrics.complianceList;

              if (complianceList.length === 0) {
                return (
                  <div className="p-12 text-center text-zinc-400 text-sm">
                    No fleet vehicles registered.
                  </div>
                );
              }

              return complianceList.map((veh, i) => (
                <div key={i} className="flex items-center justify-between p-4 bg-zinc-50 rounded-2xl border border-zinc-100">
                  <div>
                    <p className="text-sm font-bold text-zinc-900">{veh.name}</p>
                    <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-medium">{veh.item}</p>
                  </div>
                  <div className="text-right">
                    <div className={cn(
                      "h-3 w-3 rounded-full ml-auto mb-1",
                      veh.status === 'Critical' ? "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]" :
                      veh.status === 'Warning' ? "bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]" :
                      "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"
                    )} />
                    <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">{veh.days} days left</p>
                  </div>
                </div>
              ));
            })()}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Route Profitability */}
        <div className="bg-white p-8 rounded-3xl border border-zinc-200 shadow-sm">
          <h3 className="text-lg font-bold text-zinc-900 mb-6">Route Profitability</h3>
          <div className="space-y-4">
            {(() => {
              const routeList = metrics.routeList;

              if (routeList.length === 0) {
                return (
                  <div className="p-12 text-center text-zinc-400 text-sm">
                    No active delivery routes.
                  </div>
                );
              }

              return routeList.map((route, i) => (
                <div key={i} className="flex items-center justify-between p-4 bg-zinc-50 rounded-2xl border border-zinc-100">
                  <div>
                    <p className="text-sm font-bold text-zinc-900">{route.route}</p>
                    <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-medium">Revenue: UGX {route.revenue.toLocaleString()}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-emerald-600">UGX {route.profit.toLocaleString()}</p>
                    <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">Cost: UGX {route.cost.toLocaleString()}</p>
                  </div>
                </div>
              ));
            })()}
          </div>
        </div>

        {/* Driver/Rider Performance */}
        <div className="bg-white p-8 rounded-3xl border border-zinc-200 shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-bold text-zinc-900">Driver/Rider Performance</h3>
            <User className="text-zinc-400" size={20} />
          </div>
          <div className="space-y-4">
            {(() => {
              const driverList = metrics.driverList;

              if (driverList.length === 0) {
                return (
                  <div className="p-12 text-center text-zinc-400 text-sm">
                    No fleet drivers registered.
                  </div>
                );
              }

              return driverList.map((driver, i) => (
                <div key={i} className="flex items-center justify-between p-4 bg-zinc-50 rounded-2xl border border-zinc-100">
                  <div>
                    <p className="text-sm font-bold text-zinc-900">{driver.name}</p>
                    <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-medium">{driver.trips} trips • {driver.tat} avg TAT</p>
                  </div>
                  <div className="text-right">
                    <p className={cn(
                      "text-sm font-bold",
                      driver.incidents > 0 ? "text-amber-600" : "text-emerald-600"
                    )}>{driver.incidents} incidents</p>
                    <span className={cn(
                      "px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest",
                      driver.status === 'Top Performer' ? "bg-emerald-50 text-emerald-600" :
                      driver.status === 'Warning' ? "bg-amber-50 text-amber-600" :
                      "bg-blue-50 text-blue-600"
                    )}>
                      {driver.status}
                    </span>
                  </div>
                </div>
              ));
            })()}
          </div>
        </div>
      </div>
    </div>
  );
};
