// Emulator AST estimate only. Hosted Firebase certification is mandatory.
import java.nio.file.*;
import com.google.firebase.rules.lang.FirebaseRulesProtoCompiler;
import com.google.firebase.rules.v1.Source;
import com.google.firebase.rules.v1.File;
import com.google.protobuf.Message;
class EstimateFirestoreAst {
 static Message strip(Message value){var b=value.toBuilder();for(var f:value.getAllFields().keySet()){
  if(f.getName().toLowerCase().contains("source_position"))b.clearField(f);
  else if(f.getJavaType()==com.google.protobuf.Descriptors.FieldDescriptor.JavaType.MESSAGE){
   if(f.isRepeated()){for(int i=0;i<b.getRepeatedFieldCount(f);i++)b.setRepeatedField(f,i,strip((Message)b.getRepeatedField(f,i)));}
   else b.setField(f,strip((Message)b.getField(f)));
  }
 }return b.build();}
 public static void main(String[] args)throws Exception{for(String path:args){var s=Source.newBuilder().addFiles(File.newBuilder().setName("firestore.rules").setContent(Files.readString(Path.of(path))));var r=FirebaseRulesProtoCompiler.createStandalone(com.google.firebase.rules.lang.common.FirebaseRulesLangOptions.builder().allowTernaryOperator(true).allowLetBindings(true).build()).compile(s);if(r.hasCompilationError())throw new IllegalStateException(r.getIssues().toString());var ast=r.getRulesetAst();System.out.println(path+" source="+Files.size(Path.of(path))+" AST="+ast.getSerializedSize()+" stripped_AST_estimate="+strip(ast).getSerializedSize());}}
}
