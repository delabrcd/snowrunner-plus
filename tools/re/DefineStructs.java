// Ghidra headless: define the drivetrain struct types (Vehicle / TruckAction / Gearbox) with named
// fields, so the decompiler shows meaningful members instead of raw +0xNN offsets. Documents our
// confirmed data model in the project. Saves the DB.
//   analyzeHeadless <proj> snowrunner -process snowrunner-fixed.bin -noanalysis -postScript DefineStructs.java
import ghidra.app.script.GhidraScript;
import ghidra.program.model.data.*;

public class DefineStructs extends GhidraScript {
    public void run() throws Exception {
        DataTypeManager dtm = currentProgram.getDataTypeManager();
        CategoryPath cp = new CategoryPath("/SnowRunner");
        DataType F = FloatDataType.dataType, I = IntegerDataType.dataType,
                 U = UnsignedIntegerDataType.dataType, B = ByteDataType.dataType;

        StructureDataType gb = new StructureDataType(cp, "Gearbox", 0x40);
        gb.replaceAtOffset(0x00, new ArrayDataType(F, 8, 4), 0, "angVelCaps", "[reverse, g1..gN] AngVel caps (ground-speed units)");
        Gearbox = (Structure) dtm.addDataType(gb, DataTypeConflictHandler.REPLACE_HANDLER);

        StructureDataType ta = new StructureDataType(cp, "TruckAction", 0x100);
        ta.replaceAtOffset(0x38, F, 0, "PowerCoef", "engine-power multiplier (~1.0)");
        ta.replaceAtOffset(0x3C, B, 0, "IsInAutoMode", "0 = manual");
        ta.replaceAtOffset(0x44, F, 0, "Accel", "throttle input");
        ta.replaceAtOffset(0x50, F, 0, "Torque", "static engine XML torque (70000)");
        ta.replaceAtOffset(0x58, new PointerDataType(Gearbox), 0, "gearbox", null);
        ta.replaceAtOffset(0x70, I, 0, "gear", "CURRENT gear (-1=R 0=N 1..n)");
        ta.replaceAtOffset(0x74, I, 0, "commandedGear", "TARGET gear; write to shift (with IsInAutoMode=0)");
        ta.replaceAtOffset(0xB4, F, 0, "torqueLoad", "live engine torque/load (0..1); jumps up at upshift");
        ta.replaceAtOffset(0xDC, F, 0, "switchThreshold", "auto-shift threshold");
        ta.replaceAtOffset(0xE0, I, 0, "nextGear", null);
        TruckAction = (Structure) dtm.addDataType(ta, DataTypeConflictHandler.REPLACE_HANDLER);

        StructureDataType veh = new StructureDataType(cp, "Vehicle", 0x800);
        veh.replaceAtOffset(0x68, new PointerDataType(TruckAction), 0, "truckAction", null);
        veh.replaceAtOffset(0x200, new PointerDataType(DataType.DEFAULT), 0, "wheelsBegin", "vector<TRUCK_WHEEL_MODEL*>");
        veh.replaceAtOffset(0x208, new PointerDataType(DataType.DEFAULT), 0, "wheelsEnd", null);
        veh.replaceAtOffset(0x5D0, new PointerDataType(DataType.DEFAULT), 0, "chassisBody", "hkpRigidBody");
        veh.replaceAtOffset(0x768, U, 0, "q_VehStateFlags", "bit0 = ENGINE RUNNING");
        dtm.addDataType(veh, DataTypeConflictHandler.REPLACE_HANDLER);

        println("SnowRunner structs defined: Gearbox, TruckAction, Vehicle (see Data Type Manager /SnowRunner)");
    }

    Structure Gearbox, TruckAction;
}
