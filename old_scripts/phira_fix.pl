# 把导出的 txt 改成 Phira 实际读取的 PEC 规范：
#   n1/n3/n4  line  Beat  X  side  isFake
#   n2        line  Beat  holdBeat  X  side  isFake
# 关键修复：X 用 PEC 像素（positionX * 115.2），不是 0.05625 那个比值
open F,"<:utf8","c.txt"; my @out; my $n=0;
while(<F>){
  s/\x{feff}//g; s/\r//g; next unless /\S/;
  my @p = split;
  my ($tag,$line,$b1,$b2,$x,$side,$fake) = @p[0..6];
  next unless defined $fake;
  my $px = $x * 115.2;                     # ✅ 像素
  my $pxs = sprintf("%.2f", $px); $pxs =~ s/\.?0+$//; $pxs = "0" if $pxs eq "-0";
  if ($tag eq "n2") {
    push @out, sprintf("%s %d %.3f %.3f %s %d %d\n# 1.0\n& 1.0", $tag,$line,$b1,$b2,$pxs,$side,$fake);
  } else {
    push @out, sprintf("%s %d %.3f %s %d %d\n# 1.0\n& 1.0", $tag,$line,$b1,$pxs,$side,$fake);
  }
  $n++;
}
print "转换 $n 条音符\n";
open O,">:utf8","chart_phira.pec"; print O map {"$_\n"} @out; close O;
